import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {RecallClassifier,reviewQueue} from '../recall-first/classifier.ts';
import {POLICY,normalizeName,recordingParts} from '../recall-first/policy.ts';
import {HOLDOUT,type Case} from '../recall-first/holdout.ts';
import {DISCOGS_BENCHMARK} from '../discogs/benchmark.ts';
import {FRESH} from './holdout.ts';
import type {Query,Result} from '../recall-first/types.ts';
const directory=new URL('./',import.meta.url),oldPath=new URL('../recall-first/artifacts/index.sqlite',directory).pathname;
const newPath=new URL('./artifacts/index.sqlite',directory).pathname,sourcePath=new URL('./artifacts/source.sqlite',directory).pathname;
const frozen=JSON.parse(readFileSync(new URL('./frozen-inputs.json',directory),'utf8')) as Record<string,string>;
for(const [path,hash] of Object.entries(frozen))if(createHash('sha256').update(readFileSync(new URL(path,directory))).digest('hex')!==hash)throw Error('Frozen classifier/evaluation input changed: '+path);
const old=new RecallClassifier(oldPath),expanded=new RecallClassifier(newPath);
const key=(q:Query)=>JSON.stringify([normalizeName(q.artist),recordingParts(q.title)]);
const previous=new Set([...HOLDOUT,...DISCOGS_BENCHMARK].map(key));
if(FRESH.some(q=>previous.has(key(q)))||new Set(FRESH.map(key)).size!==FRESH.length)throw Error('Fresh holdout overlap');
type Row={query:Case,result:Result};
const ratio=(n:number,d:number)=>({numerator:n,denominator:d,value:d?n/d:null});
function metrics(rows:Row[]){
 const judged=rows.filter(r=>r.query.gold!==null),house=judged.filter(r=>r.query.gold==='house'),definite=judged.filter(r=>r.result.category==='DEFINITELY_HOUSE');
 const review=reviewQueue(rows),judgedQueue=review.filter(r=>r.query.gold!==null);
 const dcg=(r:Row[])=>r.slice(0,10).reduce((n,v,i)=>n+(v.query.gold==='house'?1/Math.log2(i+2):0),0);
 const ideal=dcg([...judgedQueue].sort((a,b)=>Number(b.query.gold==='house')-Number(a.query.gold==='house')));
 return {total:rows.length,judged:judged.length,definitelyPrecision:ratio(definite.filter(r=>r.query.gold==='house').length,definite.length),definitelyRecall:ratio(house.filter(r=>r.result.category==='DEFINITELY_HOUSE').length,house.length),
 definitelyPlusPossiblyRecall:ratio(house.filter(r=>['DEFINITELY_HOUSE','POSSIBLY_HOUSE'].includes(r.result.category)).length,house.length),
 retainedIncludingUnknownRecall:ratio(house.filter(r=>r.result.category!=='NOT_HOUSE').length,house.length),incorrectlyExcluded:house.filter(r=>r.result.category==='NOT_HOUSE').map(r=>r.query.id),
 review:ratio(review.length,rows.length),unknown:ratio(rows.filter(r=>r.result.category==='UNKNOWN').length,rows.length),possibly:ratio(rows.filter(r=>r.result.category==='POSSIBLY_HOUSE').length,rows.length),
 houseAmongJudgedReview:ratio(judgedQueue.filter(r=>r.query.gold==='house').length,judgedQueue.length),ndcgAt10:ideal?dcg(judgedQueue)/ideal:null,
 top5Precision:ratio(judgedQueue.slice(0,5).filter(r=>r.query.gold==='house').length,Math.min(5,judgedQueue.length))};
}
function comparison(cases:Case[]){
 const rows=cases.map(query=>({query,old:old.classify(query),expanded:expanded.classify(query)}));
 const selected=(method:'old'|'expanded',group=rows)=>group.map(r=>({query:r.query,result:r[method]}));
 const ranking=(method:'old'|'expanded')=>Array.from({length:20},(_,i)=>{
  const ordered=[...rows].sort((a,b)=>createHash('sha256').update(i+'|'+a.query.id).digest('hex').localeCompare(createHash('sha256').update(i+'|'+b.query.id).digest('hex')));
  const m=metrics(selected(method,ordered));return {ndcg:m.ndcgAt10,precisionAt5:m.top5Precision};
 });
 return {metrics:{old:metrics(selected('old')),expanded:metrics(selected('expanded'))},rankingSensitivity:{old:ranking('old'),expanded:ranking('expanded')},
 byGroup:Object.fromEntries([...new Set(cases.map(q=>q.group))].map(g=>[g,{old:metrics(selected('old',rows.filter(r=>r.query.group===g))),expanded:metrics(selected('expanded',rows.filter(r=>r.query.group===g)))}])),rows};
}
const existing=comparison(HOLDOUT),fresh=comparison(FRESH);
// Same deterministic, distinct 2,000 recording groups sampled from OLD index for
// comparison; supplemented by 2,000 spread through expanded index, no gold used.
function batch(path:string){const db=new DatabaseSync(path,{readOnly:true});const count=Number(db.prepare('SELECT COUNT(*) AS n FROM track_index').get()!.n),stride=Math.max(1,Math.floor(count/2000));let i=0;const queries:Query[]=[];
 for(const value of db.prepare('SELECT artist,title,version,duration_min FROM track_index ORDER BY artist,title,version,cluster').iterate()){
 const r=value as {artist:string;title:string;version:string;duration_min:number|null};
 if(i++%stride===0)queries.push({artist:r.artist,title:r.title+(r.version==='original'?'':` (${r.version})`),durationMs:r.duration_min??undefined});if(queries.length===2000)break;}
 db.close();return queries;}
function time(engine:RecallClassifier,queries:Query[]){const times:number[]=[],categories:Record<string,number>={};const start=performance.now();for(const q of queries){const t=performance.now(),result=engine.classify(q);times.push(performance.now()-t);categories[result.category]=(categories[result.category]||0)+1;}const totalMs=performance.now()-start;times.sort((a,b)=>a-b);return {queries:queries.length,totalMs,medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],categories};}
const oldBatch=batch(oldPath),expandedBatch=batch(newPath);
const timings={oldCatalogQueries:{old:time(old,oldBatch),expanded:time(expanded,oldBatch)},expandedCatalogQueries:{old:time(old,expandedBatch),expanded:time(expanded,expandedBatch)}};
const source=new DatabaseSync(sourcePath,{readOnly:true});source.function('rf_name',{deterministic:true},v=>normalizeName(String(v)));
const names=new Set([...HOLDOUT,...FRESH].map(q=>normalizeName(q.artist))),artistIds=new Map<string,number[]>();
for(const r of source.prepare('SELECT id,name FROM artists').iterate() as Iterable<{id:number;name:string}>){const key=normalizeName(r.name);if(names.has(key)){const ids=artistIds.get(key)||[];ids.push(r.id);artistIds.set(key,ids);}}
// Resolve source credit aliases just as the compact builder does; diagnostics
// must not mistake an alias-resolved match for missing source metadata.
for(const r of source.prepare('SELECT artist_id,name FROM artist_aliases').iterate() as Iterable<{artist_id:number;name:string}>){const alias=normalizeName(r.name.replace(/\s+\(\d+\)$/,""));if(names.has(alias)){const ids=artistIds.get(alias)||[];if(!ids.includes(r.artist_id))ids.push(r.artist_id);artistIds.set(alias,ids);}}
const diagnostics=[...HOLDOUT,...FRESH].map(q=>{
 const ids=artistIds.get(normalizeName(q.artist))||[],parts=recordingParts(q.title);
 const candidates=ids.flatMap(id=>source.prepare('SELECT id,title,duration_ms FROM recordings WHERE primary_artist_id=?').all(id)).filter(r=>recordingParts(String(r.title)).base===parts.base);
 const version=candidates.filter(r=>recordingParts(String(r.title)).version===parts.version);
 const compatible=version.filter(r=>q.durationMs===undefined||r.duration_ms===null||Number(r.duration_ms)<=0||Math.abs(Number(r.duration_ms)-q.durationMs)<=POLICY.durationToleranceMs);
 const result=expanded.classify(q);
 return {id:q.id,artist:q.artist,title:q.title,artistFound:!!ids.length,baseCandidates:candidates.length,versionCandidates:version.length,individuallyCompatibleDurations:compatible.length,matchedCompactGroups:result.matchedGroups,category:result.category,
 diagnosis:!candidates.length?'No exact normalized artist/base-title candidates in retained source; use full-archive audit to distinguish source absence from extraction omission':!version.length||!compatible.length?'Matching/version/duration limitation':!result.matchedGroups?'Source evidence omitted by compact retention or preprocessing; inspect whether it is no-evidence/non-house reservoir':result.category==='UNKNOWN'?'Matched context lacks sufficient usable genre evidence':result.category==='POSSIBLY_HOUSE'?'Matched evidence retained; fixed classifier requires review for weak, adjacent or conflicting context':'Automatic fixed-rule decision',samples:candidates.slice(0,4)};
});
const counts={releases:source.prepare('SELECT COUNT(*) AS n FROM releases').get()!.n,recordings:source.prepare('SELECT COUNT(*) AS n FROM recordings').get()!.n,artists:source.prepare('SELECT COUNT(*) AS n FROM artists').get()!.n,discoveredArtists:source.prepare('SELECT COUNT(*) AS n FROM relevant_artists').get()!.n,passes:source.prepare('SELECT * FROM progress ORDER BY pass').all()};source.close();old.close();expanded.close();
function indexStats(path:string){const db=new DatabaseSync(path,{readOnly:true});const result={durationRows:db.prepare('SELECT COUNT(*) AS n FROM track_index').get()!.n,retainedTitleVersionGroups:db.prepare('SELECT COUNT(*) AS n FROM (SELECT artist,title,version FROM track_index GROUP BY artist,title,version)').get()!.n,uniqueCanonicalArtists:db.prepare('SELECT COUNT(DISTINCT artist) AS n FROM artist_index').get()!.n,artistAliasLookupRows:db.prepare('SELECT COUNT(*) AS n FROM artist_index').get()!.n};db.close();return result;}
const report={indexes:{old:indexStats(oldPath),expanded:indexStats(newPath)},generatedAt:new Date().toISOString(),policySha256:createHash('sha256').update(JSON.stringify(POLICY)).digest('hex'),freshSetSha256:createHash('sha256').update(JSON.stringify(FRESH)).digest('hex'),sizes:{oldIndexBytes:statSync(oldPath).size,expandedIndexBytes:statSync(newPath).size,expandedSourceBytes:statSync(sourcePath).size},counts,build:JSON.parse(readFileSync(newPath+'.build.json','utf8')),existing40:existing,fresh,timings,diagnostics,
 limitations:['Source selection is genre-first; broad Electronic can discover artists with predominantly unrelated work. Artist profiles remain a metadata sample, never complete discographies.','All accuracy denominators exclude unadjudicated gold; named-version textual identity and editorial genre judgments are fallible. No audio identity verification.','Same frozen policy and classifier for both catalogs; no manual overrides, gold-driven scope or score tuning.','UNKNOWN remains reviewable, so retained recall alone is insufficient; examine review burden and definite-plus-possible recall.','Timings are local observations with uncontrolled cache/order/load; catalog-derived workload is not an accuracy test.','Full source audit covers five requested probes, not every evaluation candidate. Other source-absence diagnoses remain provisional.']};
writeFileSync(new URL('./results.json',directory),JSON.stringify(report,null,2));console.log(JSON.stringify({sizes:report.sizes,existing:existing.metrics,fresh:fresh.metrics,timings},null,2));
