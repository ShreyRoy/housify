// Bound offline scratch space by partitioning normalized artist keys. Every
// artist's complete evidence stays together; the existing builder does all
// normalization, consensus, retention and profiling, without scoring changes.
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {closeSync,existsSync,fsyncSync,mkdirSync,mkdtempSync,openSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {POLICY,normalizeName} from '../recall-first/policy.ts';
const sourcePath=resolve(process.argv[2]||'experiments/local-catalog/expanded/artifacts/source.sqlite');
const output=resolve(process.argv[3]||'experiments/local-catalog/expanded/artifacts/index.sqlite');
const partitions=Number(process.argv[4]||32);
if(sourcePath===output||!Number.isInteger(partitions)||partitions<1||partitions>128)throw Error('Distinct source/output and 1–128 partitions required');
mkdirSync(dirname(output),{recursive:true});
const work=mkdtempSync(join(dirname(output),`build-work-${process.pid}-`)),temporary=output+`.building-${process.pid}`,started=performance.now();
const reports:Record<string,unknown>[]=[],buckets:number[][]=Array.from({length:partitions},()=>[]);
let source=new DatabaseSync(sourcePath,{readOnly:true});
if(source.prepare('SELECT status FROM import_state').get()?.status!=='complete')throw Error('Both full import passes must complete');
const scope=source.prepare('SELECT * FROM catalog_scope').get(),snapshots=source.prepare('SELECT id,url,license,version FROM sources').all();
const needsReverseIndex=!source.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='release_recording_idx'").get();
source.close();
if(needsReverseIndex){
 console.log(JSON.stringify({stage:'prepare reverse track lookup'}));
 const writable=new DatabaseSync(sourcePath);writable.exec('PRAGMA temp_store=FILE; PRAGMA cache_size=-32768; CREATE INDEX release_recording_idx ON release_tracks(recording_id); PRAGMA wal_checkpoint(TRUNCATE)');writable.close();
}
source=new DatabaseSync(sourcePath,{readOnly:true});
{
 const groups=new Map<string,number[]>();
 for(const row of source.prepare('SELECT id,name FROM artists').iterate() as Iterable<{id:number;name:string}>){const key=normalizeName(row.name),ids=groups.get(key)||[];ids.push(row.id);groups.set(key,ids);}
 // Contiguous UTF-8/BINARY key ranges also let the merged track index grow in
 // primary-key order, avoiding storage wasted by scattered insertion ranges.
 const ordered=[...groups].map(([key,ids])=>({encoded:Buffer.from(key),ids})).sort((a,b)=>Buffer.compare(a.encoded,b.encoded));
 const width=Math.max(1,Math.ceil(ordered.length/partitions));
 for(let i=0;i<ordered.length;i++)for(const id of ordered[i].ids)buckets[Math.floor(i/width)].push(id);
}
source.close();
rmSync(temporary,{force:true});
const out=new DatabaseSync(temporary);
// Only this disposable derived file uses journal OFF. Existing source/index and
// manual overrides never do. A failed build is discarded, not resumed in place.
out.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-32768');
out.exec(readFileSync(new URL('../recall-first/schema.sql',import.meta.url),'utf8'));
try{
 for(let bucket=0;bucket<partitions;bucket++){
  if(!buckets[bucket].length)continue;
  const partSource=join(work,'source.sqlite'),partIndex=join(work,'index.sqlite');
  const part=new DatabaseSync(partSource);
  part.prepare('ATTACH DATABASE ? AS src').run(pathToFileURL(sourcePath).href+'?mode=ro');
  part.exec('PRAGMA src.cache_size=-32768; PRAGMA cache_size=-32768; PRAGMA temp_store=FILE; CREATE TEMP TABLE selected(id INTEGER PRIMARY KEY); BEGIN');
  const select=part.prepare('INSERT INTO selected VALUES(?)');for(const id of buckets[bucket])select.run(id);
  part.exec(`
   CREATE TABLE artists AS SELECT a.* FROM selected s CROSS JOIN src.artists a WHERE a.id=s.id;
   CREATE TABLE artist_aliases AS SELECT al.* FROM selected s CROSS JOIN src.artist_aliases al WHERE al.artist_id=s.id;
   CREATE TABLE recordings AS SELECT r.* FROM selected s CROSS JOIN src.recordings r WHERE r.primary_artist_id=s.id;
   CREATE UNIQUE INDEX recording_id ON recordings(id);
   CREATE INDEX recording_artist ON recordings(primary_artist_id);
   CREATE TABLE release_tracks AS SELECT rt.* FROM recordings r CROSS JOIN src.release_tracks rt WHERE rt.recording_id=r.id;
   CREATE INDEX release_recording_idx ON release_tracks(recording_id);
   CREATE TABLE releases AS SELECT * FROM src.releases WHERE id IN (SELECT release_id FROM release_tracks);
   CREATE UNIQUE INDEX release_id ON releases(id);
   CREATE TABLE release_context AS SELECT * FROM src.release_context WHERE release_id IN (SELECT id FROM releases);
   CREATE UNIQUE INDEX context_id ON release_context(release_id);
   CREATE TABLE annotations AS SELECT * FROM src.annotations WHERE entity_id IN (SELECT id FROM releases);
   CREATE INDEX annotation_entity ON annotations(entity_type,entity_id);
   CREATE TABLE genres AS SELECT * FROM src.genres;
   CREATE TABLE sources AS SELECT * FROM src.sources;
   CREATE TABLE import_state(status TEXT); INSERT INTO import_state VALUES('complete');
   CREATE TABLE catalog_scope(id INTEGER,scope TEXT,limitation TEXT);
   INSERT INTO catalog_scope VALUES(1,'genre-partition','Completed bounded preprocessing partition; not a full imported archive');
   COMMIT;`);
  const candidates=part.prepare('SELECT COUNT(*) AS n FROM recordings').get()!.n;
  part.close();
  console.log(JSON.stringify({stage:'partition consensus',partition:bucket+1,partitions,artistIds:buckets[bucket].length,candidates,elapsedSeconds:(performance.now()-started)/1000}));
  const child=spawnSync(process.execPath,['--experimental-transform-types',fileURLToPath(new URL('../recall-first/build.ts',import.meta.url)),partSource,partIndex],{stdio:'inherit'});
  if(child.status!==0)throw Error('Existing preprocessor failed in partition '+(bucket+1));
  const report=JSON.parse(readFileSync(partIndex+'.build.json','utf8')) as Record<string,unknown>;
  reports.push({...report,partition:bucket+1,candidates});
  out.prepare('ATTACH DATABASE ? AS shard').run(pathToFileURL(partIndex).href+'?mode=ro');
  if(out.prepare("SELECT value FROM shard.metadata WHERE key='policy'").get()?.value!==JSON.stringify(POLICY))throw Error('Partition policy mismatch');
  out.exec('BEGIN; INSERT INTO track_index SELECT * FROM shard.track_index; INSERT INTO artist_index SELECT * FROM shard.artist_index; COMMIT; DETACH DATABASE shard');
  rmSync(partSource);rmSync(partIndex);rmSync(partIndex+'.build.json');
 }
 const metadata={policy:POLICY,source:{path:sourcePath,bytes:statSync(sourcePath).size,scope,snapshots},semantics:'The unchanged consensus/profile builder processes complete normalized-artist partitions. Partitioning changes scratch storage only, never classification rules or import scope.'};
 for(const [key,value] of Object.entries(metadata))out.prepare('INSERT INTO metadata VALUES(?,?)').run(key,JSON.stringify(value));
 out.exec('ANALYZE');
 const trackRows=Number(out.prepare('SELECT COUNT(*) AS n FROM track_index').get()!.n),artistLookupRows=Number(out.prepare('SELECT COUNT(*) AS n FROM artist_index').get()!.n);
 if(trackRows!==reports.reduce((n,r)=>n+Number(r.trackRows),0)||artistLookupRows!==reports.reduce((n,r)=>n+Number(r.artistLookupRows),0))throw Error('Partition merge count mismatch');
 if(out.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('Derived index integrity check failed');
 out.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL');out.close();
 const fd=openSync(temporary,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temporary,output);
 const parentPeak=process.resourceUsage().maxRSS*1024,workerPeak=Math.max(0,...reports.map(r=>Number(r.peakRssBytes)));
 const result={generatedAt:new Date().toISOString(),output,sourceBytes:statSync(sourcePath).size,databaseBytes:statSync(output).size,sourceScope:scope,partitions,partitionStrategy:"Contiguous normalized canonical artist key ranges; no benchmark filters",trackRows,artistLookupRows,titleVersionGroups:reports.reduce((n,r)=>n+Number(r.titleVersionGroups),0),omittedNonHouseGroups:reports.reduce((n,r)=>n+Number(r.omittedNonHouseGroups),0),elapsedMs:performance.now()-started,parentPeakRssBytes:parentPeak,workerPeakRssBytes:workerPeak,peakRssUpperBoundBytes:parentPeak+workerPeak,memoryMethod:'Observed parent peak plus largest sequential worker peak is a conservative process-tree upper bound, not an exact simultaneous RSS measurement.',partitionReports:reports};
 writeFileSync(output+'.build.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,partitionReports:undefined},null,2));
}catch(error){try{out.close();}catch{}if(existsSync(temporary))rmSync(temporary);throw error;}
finally{rmSync(work,{recursive:true,force:true});}
