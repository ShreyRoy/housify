import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { LocalCatalog } from "../catalog.ts";
import { DISCOGS_BENCHMARK } from "../discogs/benchmark.ts";
import { RecallClassifier, reviewQueue } from "./classifier.ts";
import { HOLDOUT } from "./holdout.ts";
import type { Category, Query, Result } from "./types.ts";
import { normalizeName, recordingParts } from "./policy.ts";

const indexPath="experiments/local-catalog/recall-first/artifacts/index.sqlite";
const sourcePath="experiments/local-catalog/discogs/artifacts/selected.sqlite";
const fingerprint=(q:Query)=>JSON.stringify([normalizeName(q.artist),recordingParts(q.title)]);
const previous=new Set(DISCOGS_BENCHMARK.map(fingerprint));
if(HOLDOUT.some(row=>previous.has(fingerprint(row))))throw new Error("Fresh set overlaps prior evaluated track/version keys");
const baseline=new LocalCatalog(sourcePath,undefined,true),compact=new RecallClassifier(indexPath);
type Row={id:string;group:string;gold:"house"|"non_house"|null;baseline:{category:Category;review:boolean};result:Result;query:Query;reference:string};
const rows:Row[]=HOLDOUT.map(item=>{const old=baseline.classify(item);return {id:item.id,group:item.group,gold:item.gold,baseline:{category:old.classification,review:["UNKNOWN","POSSIBLY_HOUSE"].includes(old.classification)},result:compact.classify(item),query:{artist:item.artist,title:item.title,durationMs:item.durationMs},reference:item.reference};});
const ratio=(n:number,d:number)=>({numerator:n,denominator:d,value:d?n/d:null});
function metrics(group:Row[],method:"baseline"|"compact"){
  const category=(r:Row)=>method==="compact"?r.result.category:r.baseline.category;
  const judged=group.filter(r=>r.gold!==null),house=judged.filter(r=>r.gold==="house");
  const definite=judged.filter(r=>category(r)==="DEFINITELY_HOUSE");
  const review=(r:Row)=>["UNKNOWN","POSSIBLY_HOUSE"].includes(category(r));
  const queue=method==="compact"?reviewQueue(group):group.filter(review);
  const judgedQueue=queue.filter(r=>r.gold!==null);
  const houseInReview=judgedQueue.filter(r=>r.gold==="house");
  const dcg=(items:Row[])=>items.slice(0,10).reduce((n,r,i)=>n+(r.gold==="house"?1/Math.log2(i+2):0),0);
  const ideal=dcg([...judgedQueue].sort((a,b)=>Number(b.gold==="house")-Number(a.gold==="house")));
  return {total:group.length,independentlyLabeled:judged.length,definitelyHousePrecision:ratio(definite.filter(r=>r.gold==="house").length,definite.length),definitelyHouseRecall:ratio(house.filter(r=>category(r)==="DEFINITELY_HOUSE").length,house.length),
    definitelyOrAnyReviewRecall:ratio(house.filter(r=>category(r)!=="NOT_HOUSE").length,house.length),
    definitelyOrPossiblyRecallExcludingUnknown:ratio(house.filter(r=>["DEFINITELY_HOUSE","POSSIBLY_HOUSE"].includes(category(r))).length,house.length),
    actualHouseIncorrectlyExcluded:house.filter(r=>category(r)==="NOT_HOUSE").map(r=>r.id),
    manualReview:ratio(group.filter(review).length,group.length),unknown:ratio(group.filter(r=>category(r)==="UNKNOWN").length,group.length),possibly:ratio(group.filter(r=>category(r)==="POSSIBLY_HOUSE").length,group.length),
    automaticDecisions:ratio(group.filter(r=>!review(r)).length,group.length),
    houseAmongJudgedReviewCandidates:ratio(houseInReview.length,judgedQueue.length),
    reviewRanking:{judgedOnlyNdcgAt10:ideal?dcg(judgedQueue)/ideal:null,judgedOnlyPrecisionAt5:ratio(judgedQueue.slice(0,5).filter(r=>r.gold==="house").length,Math.min(5,judgedQueue.length)),
      first10:queue.slice(0,10).map(r=>({id:r.id,gold:r.gold,priority:method==="compact"?r.result.review.priority:null})),
      limitation:"NDCG/precision filter unadjudicated genres rather than treating them as negatives. Baseline queue uses input order; it has no prioritization."}};
}
function rankingSensitivity(method:"baseline"|"compact"){
  // The curation file groups genres, so its original order is not a neutral
  // playlist-order baseline. Use 20 deterministic, label-independent orders;
  // retain original-order metrics as well rather than hiding that result.
  const values=Array.from({length:20},(_,round)=>{
    const key=(row:Row)=>createHash("sha256").update(JSON.stringify([row.query,round])).digest("hex");
    const ordered=[...rows].sort((a,b)=>key(a).localeCompare(key(b)));
    const ranking=metrics(ordered,method).reviewRanking;
    return {round,ndcg:ranking.judgedOnlyNdcgAt10,precisionAt5:ranking.judgedOnlyPrecisionAt5};
  });
  const valid=values.map(v=>v.ndcg).filter((v):v is number=>v!==null);
  const precision=values.map(v=>v.precisionAt5.value).filter((v):v is number=>v!==null);
  return {orders:20,meanJudgedNdcgAt10:valid.reduce((n,v)=>n+v,0)/valid.length,minJudgedNdcgAt10:Math.min(...valid),maxJudgedNdcgAt10:Math.max(...valid),meanJudgedPrecisionAt5:precision.reduce((n,v)=>n+v,0)/precision.length,values,
    limitation:"Added to address genre-grouped input-order bias; no classifier rules changed. Same small partially adjudicated test pool, not a new independent validation."};
}
// Distinct compact recording/version/duration groups chosen by deterministic
// hash, not repeated fixture requests or accuracy labels. Both implementations
// receive identical artist/title/duration queries, without pressing IDs.
const db=new DatabaseSync(indexPath,{readOnly:true});
db.function("sample_key",{deterministic:true},value=>createHash("sha256").update(String(value)).digest("hex"));
const batch=(db.prepare("SELECT artist,title,version,duration_min,duration_max FROM track_index ORDER BY sample_key(artist||'|'||title||'|'||version||'|'||cluster) LIMIT 2000").all() as {artist:string;title:string;version:string;duration_min:number|null;duration_max:number|null}[])
  .map(row=>({artist:row.artist,title:row.title+(row.version==="original"?"":` (${row.version})`),durationMs:row.duration_min===null?undefined:row.duration_min}));
db.close();
function timed(method:"baseline"|"compact"){
  const times:number[]=[],counts:Record<string,number>={};const start=performance.now();
  for(const q of batch){const t=performance.now();const category=method==="compact"?compact.classify(q).category:baseline.classify(q).classification;times.push(performance.now()-t);counts[category]=(counts[category]||0)+1;}
  times.sort((a,b)=>a-b);const totalMs=performance.now()-start;
  return {queries:batch.length,totalMs,queriesPerSecond:batch.length/(totalMs/1000),medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],categoryCounts:counts};
}
const timings={baseline:timed("baseline"),compact:timed("compact")};
const build=JSON.parse(readFileSync(indexPath+".build.json","utf8"));
const result={generatedAt:new Date().toISOString(),holdoutSha256:createHash("sha256").update(JSON.stringify(HOLDOUT)).digest("hex"),design:"40 new track/version candidates, all held out; independent genre references where available. No benchmark names or labels enter preprocessing. Inherited source was artist-targeted; this is not an unbiased catalog or an audio-identity validation.",
  databaseBytes:statSync(indexPath).size,sourceBytes:statSync(sourcePath).size,build,
  metrics:{baseline:metrics(rows,"baseline"),compact:metrics(rows,"compact")},
  rankingSensitivity:{baseline:rankingSensitivity("baseline"),compact:rankingSensitivity("compact")},
  artistProfilePresent:{baseline:metrics(rows.filter(r=>!!r.result.artist),"baseline"),compact:metrics(rows.filter(r=>!!r.result.artist),"compact")},
  byGroup:Object.fromEntries([...new Set(rows.map(r=>r.group))].map(group=>[group,{baseline:metrics(rows.filter(r=>r.group===group),"baseline"),compact:metrics(rows.filter(r=>r.group===group),"compact")}])) ,
  timings,peakEvaluationRssBytes:process.resourceUsage().maxRSS*1024,
  limitations:["UNKNOWN remains reviewable, so retention recall can trivially be 100%; assess automatic recall, review burden, and review precision together.","Only the independently labeled subset supports precision/recall; unreviewed remixes and emerging-style cases are retained but not invented as gold.","Performance batch is catalog-derived and no pressing IDs are supplied. It measures lookup throughput, not classification accuracy or full-catalog coverage.","Same source and metadata queries for both methods; cache, ordering and host load are uncontrolled. Timings are observations, not a latency guarantee.","A single fresh set is small; no rules were retuned after reading its results."],rows};
baseline.close();compact.close();
writeFileSync(new URL("./results.json",import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({design:result.design,metrics:result.metrics,databaseBytes:result.databaseBytes,timings},null,2));
