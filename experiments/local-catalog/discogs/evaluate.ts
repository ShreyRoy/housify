// Offline evaluation only. No Spotify or external API imports.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { LocalCatalog } from "../catalog.ts";
import { normalizeName, titleParts } from "../../../lib/classification/matching.ts";
import { DISCOGS_BENCHMARK } from "./benchmark.ts";
import { DEFAULT_POLICY } from "../policy.ts";

const path = resolve(process.argv[2] || "experiments/local-catalog/discogs/artifacts/selected.sqlite");
const output = resolve(process.argv[3] || "experiments/local-catalog/discogs/results.json");
const initial = performance.now();
const catalog = new LocalCatalog(path, DEFAULT_POLICY, true);
const openMs = performance.now() - initial;
const state = catalog.db.prepare("SELECT * FROM import_state").get();
if (!state || state.status !== "complete") throw new Error("Import is incomplete/capped. Finish or explicitly assess its limits before claiming full-snapshot results.");
const profile = catalog.db.prepare("SELECT policy_version FROM genre_distributions LIMIT 1").get();
if (!profile || profile.policy_version !== JSON.stringify(DEFAULT_POLICY)) throw new Error("Build profiles using prepare.ts before evaluation");
const times: number[] = [];
const rows = DISCOGS_BENCHMARK.map(item => {
  const start = performance.now();
  const result = catalog.classify({title:item.title,artist:item.artist,durationMs:item.durationMs});
  times.push(performance.now()-start);
  const title=titleParts(item.title), name=normalizeName(item.artist);
  const artists=catalog.db.prepare("SELECT id,name FROM artists WHERE normalized_name=?").all(name);
  const candidates=catalog.db.prepare(`SELECT r.id,r.title,r.version,r.duration_ms,a.name AS artist FROM recordings r JOIN artists a ON a.id=r.primary_artist_id WHERE r.normalized_title=? AND a.normalized_name=? LIMIT 20`).all(title.base,name);
  const compatibleCandidateCount=catalog.db.prepare(`SELECT COUNT(*) AS count FROM recordings r JOIN artists a ON a.id=r.primary_artist_id WHERE r.normalized_title=? AND a.normalized_name=? AND r.version=? AND (? IS NULL OR r.duration_ms IS NULL OR ABS(r.duration_ms-?)<=12000)`).get(title.base,name,title.version,item.durationMs??null,item.durationMs??null)!.count as number;
  const locations=result.matchedRecording ? catalog.db.prepare(`SELECT c.source_url,d.source_position,d.source_title,r.release_date,c.release_type,c.track_count,r.compilation
    FROM release_tracks rt JOIN releases r ON r.id=rt.release_id JOIN release_context c ON c.release_id=rt.release_id JOIN release_track_details d ON d.release_id=rt.release_id AND d.position=rt.position WHERE rt.recording_id=? LIMIT 10`).all(result.matchedRecording.id):[];
  const rawMetadata=result.matchedRecording?catalog.db.prepare(`SELECT
    EXISTS(SELECT 1 FROM annotations an JOIN release_tracks rt ON rt.release_id=an.entity_id WHERE an.entity_type='release' AND rt.recording_id=?) AS genrePresent,
    EXISTS(SELECT 1 FROM release_labels rl JOIN release_tracks rt ON rt.release_id=rl.release_id WHERE rt.recording_id=?) AS labelPresent`).get(result.matchedRecording.id,result.matchedRecording.id):null;
  return { ...item, result, artistNamePresent:artists.length>0, artistNameAmbiguous:artists.length>1, titleCandidates:candidates, compatibleCandidateCount, sourceLocations:locations,
    independentlyTimed:!!item.durationMs&&!!item.identityReference,
    genreAvailable:result.evidence.some(e=>["recording","release"].includes(e.level)),
    rawGenreStylePresent:rawMetadata?rawMetadata.genrePresent===1:null,labelPresent:rawMetadata?rawMetadata.labelPresent===1:null,
    recentEligible:!!item.released && item.released>="2025-11-24" && item.released<="2026-11-24",
  };
});
type Row = typeof rows[number];
const ratio=(n:number,d:number)=>({numerator:n,denominator:d,value:d?n/d:null});
function metrics(group:Row[]){
  const gold=group.filter(r=>r.gold?.scope==="recording");
  const house=gold.filter(r=>r.gold!.family==="house"), negatives=gold.filter(r=>r.gold!.family!=="house");
  const definite=gold.filter(r=>r.result.classification==="DEFINITELY_HOUSE");
  return { rows:group.length, strictGold:gold.length,
    compatibleCandidatePresence:ratio(group.filter(r=>r.compatibleCandidateCount>0).length,group.length),
    unambiguousCandidateRetrieval:ratio(group.filter(r=>r.result.matchedRecording).length,group.length),
    verifiedRecordingRetrievalRecall:null, verifiedRecordingIdentityPrecision:null,
    identityMetricLimitation:"No independently audited expected recording IDs for all versions. Candidate retrieval and duration corroboration are proxies, not exact recording recall/precision.",
    artistNameCoverage:ratio(group.filter(r=>r.artistNamePresent).length,group.length),
    directGenreStyleCoverage:ratio(group.filter(r=>r.genreAvailable).length,group.length),
    rawGenreStyleCoverage:ratio(group.filter(r=>r.rawGenreStylePresent).length,group.length),
    genreStyleAmongMatchedCandidates:ratio(group.filter(r=>r.rawGenreStylePresent).length,group.filter(r=>r.result.matchedRecording).length),
    labelAmongMatchedCandidates:ratio(group.filter(r=>r.labelPresent).length,group.filter(r=>r.result.matchedRecording).length),
    anyEvidenceCoverage:ratio(group.filter(r=>r.result.evidence.length).length,group.length),
    definitelyHousePrecision:ratio(definite.filter(r=>r.gold!.family==="house").length,definite.length),
    definitelyHouseRecall:ratio(house.filter(r=>r.result.classification==="DEFINITELY_HOUSE").length,house.length),
    combinedHouseRecall:ratio(house.filter(r=>["DEFINITELY_HOUSE","POSSIBLY_HOUSE"].includes(r.result.classification)).length,house.length),
    definiteFalsePositiveRate:ratio(negatives.filter(r=>r.result.classification==="DEFINITELY_HOUSE").length,negatives.length),
    combinedHouseFalsePositiveRate:ratio(negatives.filter(r=>["DEFINITELY_HOUSE","POSSIBLY_HOUSE"].includes(r.result.classification)).length,negatives.length),
    unknownRate:ratio(group.filter(r=>r.result.classification==="UNKNOWN").length,group.length),
    manualReviewRate:ratio(group.filter(r=>["UNKNOWN","POSSIBLY_HOUSE"].includes(r.result.classification)).length,group.length),
    falsePositives:negatives.filter(r=>r.result.classification==="DEFINITELY_HOUSE").map(r=>r.id),
    explicitlyExcludedGoldHouse:house.filter(r=>r.result.classification==="NOT_HOUSE").map(r=>r.id),
    missedDefiniteHouse:house.filter(r=>r.result.classification!=="DEFINITELY_HOUSE").map(r=>r.id),
  };
}
// 2,000 DISTINCT imported candidates, not repetitions of the 100 test songs.
// Catalog-derived queries measure throughput only; they are not accuracy gold.
const batch=catalog.db.prepare(`SELECT r.id AS recordingId,r.title,r.duration_ms AS durationMs,a.name AS artist FROM recordings r JOIN artists a ON a.id=r.primary_artist_id WHERE r.id LIKE 'discogs:%' ORDER BY r.id LIMIT 2000`).all() as {recordingId:string;title:string;durationMs:number|null;artist:string}[];
const batchStart=performance.now();
const batchCategories:Record<string,number>={};
for(const query of batch){const category=catalog.classify({...query,durationMs:query.durationMs??undefined}).classification;batchCategories[category]=(batchCategories[category]||0)+1;}
const batchMs=performance.now()-batchStart;
const titleBatchStart=performance.now();
for(const query of batch) catalog.classify({title:query.title,artist:query.artist,durationMs:query.durationMs??undefined});
const titleBatchMs=performance.now()-titleBatchStart;
const freshConnection:number[]=[];
for(const item of DISCOGS_BENCHMARK){
  const start=performance.now();const fresh=new LocalCatalog(path,DEFAULT_POLICY,true);
  fresh.classify({title:item.title,artist:item.artist,durationMs:item.durationMs});fresh.close();freshConnection.push(performance.now()-start);
}
const warm:number[]=[];
for(const row of rows){const start=performance.now();catalog.classify({title:row.title,artist:row.artist,durationMs:row.durationMs});warm.push(performance.now()-start);}
const percentile=(values:number[],fraction:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))]??null;
const counts=Object.fromEntries(["releases","recordings","artists","labels"].map(table=>[table,catalog.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count]));
const importStats=JSON.parse(readFileSync(path+".import.json","utf8"));
const report={generatedAt:new Date().toISOString(),policy:DEFAULT_POLICY,source:"Discogs 2026-11-01 releases bulk dump, CC0-1.0",importState:state,importStats,counts,databaseBytes:statSync(path).size,
  benchmark:{total:rows.length,strictGold:rows.filter(r=>r.gold?.scope==="recording").length,excludedFromStrictGold:rows.filter(r=>!r.gold||r.gold.scope!=="recording").length,withoutReferenceLabel:rows.filter(r=>!r.gold).length,
    limitation:"100 purposively selected candidates, artist-targeted catalog and partially adjudicated genre gold. Not a random or fully independently identity-audited 100-recording accuracy benchmark. Correlated album tracks limit diversity; unknowns stay in recall denominators."},
  tuning:metrics(rows.filter(r=>r.split==="tuning")),heldOut:metrics(rows.filter(r=>r.split==="held-out")),overall:metrics(rows),
  byStratum:Object.fromEntries(["mainstream","underground","recent","adjacent","unrelated"].map(stratum=>[stratum,metrics(rows.filter(r=>r.stratum===stratum))])),
  recentVerifiedDates:metrics(rows.filter(r=>r.recentEligible)),
  performance:{openMs,firstConnectionLookupMs:times[0],initialPassMedianMs:percentile(times,.5),initialPassP95Ms:percentile(times,.95),freshConnectionMedianMs:percentile(freshConnection,.5),freshConnectionP95Ms:percentile(freshConnection,.95),warmMedianMs:percentile(warm,.5),warmP95Ms:percentile(warm,.95),batchDistinctQueries:batch.length,batchCategories,batchMs,batchQueriesPerSecond:batch.length/(batchMs/1000),titleOnlyBatchMs:titleBatchMs,titleOnlyBatchQueriesPerSecond:batch.length/(titleBatchMs/1000),processPeakRssBytes:process.resourceUsage().maxRSS*1024,
    limitation:"Fresh connection / first lookup is not OS-cold disk: import warmed filesystem caches. No system-wide cache purge was performed. Catalog-derived batch IDs make identity lookup easier than title-only user queries."},
  rows,
};
catalog.close();
writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,counts,databaseBytes:report.databaseBytes,benchmark:report.benchmark,heldOut:report.heldOut,performance:report.performance},null,2));
