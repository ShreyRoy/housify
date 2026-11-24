import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { POLICY, genreFamily, normalizeName, recordingParts } from "./policy.ts";
import { consensus, retentionRank, type Unit } from "./consensus.ts";
import type { TrackRow } from "./types.ts";

const sourcePath=resolve(process.argv[2]||"experiments/local-catalog/discogs/artifacts/selected.sqlite");
const output=resolve(process.argv[3]||"experiments/local-catalog/recall-first/artifacts/index.sqlite");
if(sourcePath===output)throw new Error("Source and compact output must differ");
mkdirSync(dirname(output),{recursive:true});
const temporary=output+`.building-${process.pid}`;rmSync(temporary,{force:true});
const start=performance.now(),source=new DatabaseSync(sourcePath,{readOnly:true}),out=new DatabaseSync(temporary);
if(source.prepare("SELECT status FROM import_state").get()?.status!=="complete")throw new Error("Source import must be complete");
source.exec("PRAGMA cache_size=-32768; PRAGMA temp_store=FILE");
out.exec(readFileSync(new URL("./schema.sql",import.meta.url),"utf8"));
source.function("rf_base",{deterministic:true},value=>recordingParts(String(value)).base);
source.function("rf_version",{deterministic:true},value=>recordingParts(String(value)).version);
source.function("rf_name",{deterministic:true},value=>normalizeName(String(value)));
source.exec("CREATE TEMP TABLE families(id INTEGER PRIMARY KEY,family TEXT); CREATE TEMP TABLE artist_keys(id TEXT PRIMARY KEY,name TEXT)");
const familyInsert=source.prepare("INSERT INTO families VALUES(?,?)");
for(const row of source.prepare("SELECT id,name FROM genres").iterate() as Iterable<{id:number;name:string}>)familyInsert.run(row.id,genreFamily(row.name));
const aliasMap=new Map<string,Set<string>>();
const artistInsert=source.prepare("INSERT INTO artist_keys VALUES(?,?)");
for(const row of source.prepare("SELECT id,name FROM artists").iterate() as Iterable<{id:string;name:string}>){const key=normalizeName(row.name);artistInsert.run(row.id,key);if(!aliasMap.has(key))aliasMap.set(key,new Set([key]));}
for(const row of source.prepare("SELECT a.name,al.name AS alias FROM artist_aliases al JOIN artists a ON a.id=al.artist_id").iterate() as Iterable<{name:string;alias:string}>){const key=normalizeName(row.name);aliasMap.get(key)?.add(normalizeName(row.alias.replace(/\s+\(\d+\)$/,"")));}
console.log(JSON.stringify({stage:"release votes",sourceScope:source.prepare("SELECT * FROM catalog_scope").get()}));
// Temporary preprocessing tables live only in this read-only connection's temp
// database. No source tables are changed, and none ship in the compact artifact.
source.exec(`CREATE TEMP TABLE votes AS
  SELECT r.id,r.title,c.track_count,c.release_type,r.compilation,
    MAX(CASE WHEN f.family='house' THEN 1 ELSE 0 END) AS house,
    MAX(CASE WHEN f.family='other' THEN 1 ELSE 0 END) AS other,
    MAX(CASE WHEN f.family='adjacent' THEN 1 ELSE 0 END) AS adjacent,
    COALESCE(json_group_array(DISTINCT g.name) FILTER(WHERE f.family!='unknown'),'[]') AS tags
  FROM releases r LEFT JOIN release_context c ON c.release_id=r.id
  LEFT JOIN annotations an ON an.entity_type='release' AND an.entity_id=r.id
  LEFT JOIN genres g ON g.id=an.genre_id LEFT JOIN families f ON f.id=an.genre_id GROUP BY r.id;
  CREATE UNIQUE INDEX votes_id ON votes(id);
  CREATE TEMP TABLE units AS SELECT ak.name AS artist,rf_base(r.title) AS title,rf_version(r.title) AS version,
    CASE WHEN r.duration_ms>0 THEN r.duration_ms ELSE NULL END AS duration,
    rf_name(v.title)||'|'||ak.name AS unit,
    MAX(CASE WHEN v.compilation=0 THEN v.house ELSE 0 END) AS house,
    MAX(CASE WHEN v.compilation=0 THEN v.other ELSE 0 END) AS other,
    MAX(CASE WHEN v.compilation=0 THEN v.adjacent ELSE 0 END) AS adjacent,
    MAX(CASE WHEN v.compilation!=0 THEN 0 WHEN v.track_count=1 THEN ${POLICY.strongSingle}
      WHEN v.track_count<=4 AND v.release_type IN ('single','ep') THEN ${POLICY.shortRelease} ELSE ${POLICY.album} END) AS reliability,
    MIN(r.primary_artist_id) AS source_artist_ids,COALESCE(MIN(CASE WHEN v.compilation=0 THEN rt.release_id END),MIN(rt.release_id)) AS sample_release,COUNT(DISTINCT rt.release_id) AS release_count,
    COALESCE(MIN(CASE WHEN v.compilation=0 THEN v.tags END),'[]') AS tags
  FROM recordings r JOIN artist_keys ak ON ak.id=r.primary_artist_id JOIN release_tracks rt ON rt.recording_id=r.id JOIN votes v ON v.id=rt.release_id
  GROUP BY 1,2,3,4,5;
  CREATE INDEX units_order ON units(artist,title,version,duration);`);
console.log(JSON.stringify({stage:"consensus",elapsedSeconds:(performance.now()-start)/1000}));
const trackInsert=out.prepare("INSERT INTO track_index VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
const artistOut=out.prepare("INSERT INTO artist_index VALUES(?,?,?,?,?,?,?,?,?,?,?)");
let group:Unit[]=[],lastKey="",artist="",groups=0,retained=0,omittedNonHouse=0;
let stats={sample:0,tagged:0,house:0,adjacent:0};
let negatives:TrackRow[][]=[];
const negativeOrder=(a:TrackRow[],b:TrackRow[])=>{
  const quality=(rows:TrackRow[])=>Math.max(...rows.map(row=>retentionRank(row).quality));
  return quality(b)-quality(a)||retentionRank(a[0]).tie.localeCompare(retentionRank(b[0]).tie);
};
const save=(row:TrackRow)=>{trackInsert.run(row.artist,row.title,row.version,row.cluster,row.duration_min,row.duration_max,row.house,row.other,row.adjacent,row.conflict,row.strong_house,row.strong_other,row.units,row.house_units,row.other_units,row.tags,row.provenance);retained++;};
const endArtist=()=>{
  if(!artist)return;
  const ranked=negatives.sort(negativeOrder);
  ranked.slice(0,POLICY.maxNonHouseTracksPerArtist).flat().forEach(save);omittedNonHouse+=Math.max(0,ranked.length-POLICY.maxNonHouseTracksPerArtist);
  const affinity=stats.tagged?stats.house/stats.tagged:0,adjacentAffinity=stats.tagged?stats.adjacent/stats.tagged:0,coverage=stats.sample?stats.tagged/stats.sample:0;
  const kind=stats.tagged>=POLICY.minArtistSupport&&stats.house>=POLICY.minHouseSupport&&affinity>=POLICY.predominantlyHouse&&coverage>=POLICY.minArtistCoverage?"predominantly_house":affinity>=POLICY.meaningfulHouseAffinity&&stats.house>=POLICY.minHouseSupport?"mixed_house":adjacentAffinity>=POLICY.adjacentAffinity?"electronic":"predominantly_non_house";
  const aliases=[...aliasMap.get(artist)||new Set([artist])].sort();
  for(const alias of aliases)artistOut.run(alias,artist,JSON.stringify(aliases.slice(0,20)),stats.sample,stats.tagged,stats.house,stats.adjacent,affinity,adjacentAffinity,coverage,kind);
  negatives=[];stats={sample:0,tagged:0,house:0,adjacent:0};
};
const flush=()=>{
  if(!group.length)return;
  if(artist!==group[0].artist){endArtist();artist=group[0].artist;}
  const rows=consensus(group);stats.sample++;if(rows.some(r=>r.house||r.other||r.adjacent))stats.tagged++;if(rows.some(r=>r.house))stats.house++;if(rows.some(r=>r.adjacent))stats.adjacent++;
  // Retain all duration alternatives of a selected title/version, including
  // untagged alternatives. Otherwise dropping a variant could create false
  // certainty for a query whose duration is missing.
  if(rows.some(row=>row.house||row.adjacent))rows.forEach(save);
  else if(rows.some(row=>row.other))negatives.push(rows);
  // Keep the bounded best negative reservoir; no artist/benchmark name filters.
  if(negatives.length>2*POLICY.maxNonHouseTracksPerArtist){negatives.sort(negativeOrder);omittedNonHouse+=negatives.length-POLICY.maxNonHouseTracksPerArtist;negatives=negatives.slice(0,POLICY.maxNonHouseTracksPerArtist);}
  group=[];groups++;
  if(groups%5000===0){out.exec("COMMIT; BEGIN");console.log(JSON.stringify({stage:"consensus",titleVersionGroups:groups,retainedRows:retained,elapsedSeconds:(performance.now()-start)/1000}));}
};
out.exec("BEGIN");
for(const row of source.prepare("SELECT * FROM units ORDER BY artist,title,version,duration").iterate() as Iterable<Unit>){const key=JSON.stringify([row.artist,row.title,row.version]);if(key!==lastKey){flush();lastKey=key;}group.push(row);}
flush();endArtist();out.exec("COMMIT");
const sourceScope=source.prepare("SELECT * FROM catalog_scope").get();
const metadata={policy:POLICY,source:{path:sourcePath,bytes:statSync(sourcePath).size,scope:sourceScope,snapshots:source.prepare("SELECT id,url,license,version FROM sources").all()},semantics:"Consensus is genre evidence across logical releases; never pressing or exact-audio identity. Input artist-targeting cannot be undone by compaction."};
for(const [key,value]of Object.entries(metadata))out.prepare("INSERT INTO metadata VALUES(?,?)").run(key,JSON.stringify(value));
out.exec("ANALYZE");
const artistRows=out.prepare("SELECT COUNT(*) AS n FROM artist_index").get()!.n;
out.close();source.close();renameSync(temporary,output);
const result={generatedAt:new Date().toISOString(),output,sourceBytes:statSync(sourcePath).size,databaseBytes:statSync(output).size,titleVersionGroups:groups,trackRows:retained,artistLookupRows:artistRows,omittedNonHouseGroups:omittedNonHouse,elapsedMs:performance.now()-start,peakRssBytes:process.resourceUsage().maxRSS*1024,sourceScope,limitations:"Source is inherited artist-targeted data; builder never reads benchmark names. Not an unbiased worldwide catalog. Negative title/version reservoir capped after full mixed-profile computation; house/adjacent title/version groups are not capped. Duration alternatives are retained together."};
writeFileSync(output+".build.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
