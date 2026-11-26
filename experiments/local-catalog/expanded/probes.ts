import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {RecallClassifier} from '../recall-first/classifier.ts';
import {genreFamily} from '../recall-first/policy.ts';
const directory=new URL('./',import.meta.url);
const audit=JSON.parse(readFileSync(new URL('./source-audit.json',directory),'utf8')) as {scanned:number;probes:{artist:string;title:string;matches:{releaseId:string;artistId:number;title:string;durationMs:number|null;tags:string[];formats:string[]}[]}[]};
const db=new DatabaseSync(new URL('./artifacts/source.sqlite',directory).pathname,{readOnly:true}),classifier=new RecallClassifier(new URL('./artifacts/index.sqlite',directory).pathname);
const probes=audit.probes.map(p=>{
 const releaseIds=[...new Set(p.matches.map(m=>m.releaseId))];
 const retained=releaseIds.filter(id=>!!db.prepare('SELECT id FROM releases WHERE id=?').get(Number(id)));
 const relevant=p.matches.filter(m=>m.tags.some(t=>['house','adjacent'].includes(genreFamily(t))));
 const genreExpectedIds=new Set(relevant.map(m=>m.releaseId));
 const query={artist:p.artist,title:p.title,durationMs:p.matches.find(m=>m.durationMs)?.durationMs??undefined};
 const result=classifier.classify(query);
 return {...p,query,result,fullArchiveExactMatches:p.matches.length,uniqueSourceReleases:releaseIds.length,retainedReleases:retained.length,genreEligibleReleases:genreExpectedIds.size,
 genreEligibleButMissingFromExtraction:[...genreExpectedIds].filter(id=>!retained.includes(id)),
 assessment:!p.matches.length?'No exact credited original-title match in full archive audit':!retained.length?'Source data exists but was omitted by extraction':!result.matchedGroups?'Extraction contains release, but matching or compact retention needs inspection':result.category==='UNKNOWN'?'Source and compact match exist, but fixed rules find insufficient usable context':result.category==='POSSIBLY_HOUSE'?'Source and compact matches retained; fixed conservative rules route genre conflicts/weakness to review':'Useful source evidence produces an automatic fixed-rule decision'};
});
db.close();classifier.close();writeFileSync(new URL('./probe-results.json',directory),JSON.stringify({archiveReleasesScanned:audit.scanned,limitation:'Exact normalized titles/credit names, not an exhaustive audio/alias search. Durations use an observed archive value; direct comparison evaluation retains its original frozen queries.',probes},null,2));
console.log(probes.map(p=>({artist:p.artist,title:p.title,source:p.uniqueSourceReleases,retained:p.retainedReleases,category:p.result.category,missing:p.genreEligibleButMissingFromExtraction})));
