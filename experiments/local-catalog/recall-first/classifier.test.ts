import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LocalCatalog } from "../catalog.ts";
import type { CatalogData } from "../types.ts";
import { RecallClassifier, reviewQueue } from "./classifier.ts";
import { Overrides } from "./overrides.ts";
import { genreFamily, recordingParts, POLICY } from "./policy.ts";
import { consensus, type Unit } from "./consensus.ts";

const directory=mkdtempSync(join(tmpdir(),"housify-recall-"));
const sourcePath=join(directory,"source.sqlite"),indexPath=join(directory,"index.sqlite");
const data:CatalogData={sources:[{id:"test",name:"Independent synthetic policy fixture",url:"local:test",license:"CC0-1.0",version:"1",obtainedAt:"2026-11-24"}],artists:[],labels:[],recordings:[],releases:[],annotations:[]};
function add(artist:string,title:string,genre:string,durationMs=240000){
  let person=data.artists.find(a=>a.name===artist);if(!person){person={id:`artist-${data.artists.length}`,name:artist,sourceId:"test"};data.artists.push(person);}
  const id=`r-${data.recordings.length}`,release=`release-${data.releases.length}`;
  data.recordings.push({id,title,artistIds:[person.id],durationMs,isrcs:[],sourceId:"test"});
  data.releases.push({id:release,title:`Single ${id}`,recordingIds:[id],labels:[],sourceId:"test"});
  data.annotations.push({entity:"release",entityId:release,genre,sourceId:"test"});
}
for(let i=0;i<5;i++){add("House DJ",`House Song ${i}`,"Tech House");add("Mixed Producer",`Dance ${i}`,"House");add("Mixed Producer",`Other ${i}`,"Techno");}
for(let i=0;i<100;i++)add("Rapper",`Rap Song ${i}`,"Hip Hop");
add("Rapper","Independent Dance Cut","House");
add("Rapper","Shared Track","Hip Hop");add("Rapper","Shared Track (Iris Remix)","House");
add("Mixed Producer","Unmarked Version","House",240000);add("Mixed Producer","Unmarked Version","Rock",120000);
add("Mixed Producer","Partial Metadata","Rock",120000);add("Mixed Producer","Partial Metadata","Unrecognized Metadata",240000);
const source=new LocalCatalog(sourcePath);source.import(data);
source.db.prepare("INSERT INTO import_state VALUES(1,'fixture','{}',1,1,'complete',0)").run();
source.db.prepare("INSERT INTO catalog_scope VALUES(1,'test','Synthetic engineering fixture only')").run();
for(const release of data.releases)source.db.prepare("INSERT INTO release_context VALUES(?,'single',1,1,1,'','[]','local:test','test')").run(release.id);
source.db.prepare("INSERT INTO artist_aliases VALUES(?,?,?)").run(data.artists.find(a=>a.name==="House DJ")!.id,"House Deejay","house deejay");
source.close();
const built=spawnSync(process.execPath,["--experimental-transform-types","experiments/local-catalog/recall-first/build.ts",sourcePath,indexPath],{encoding:"utf8"});
assert.equal(built.status,0,built.stdout+built.stderr);
const classifier=new RecallClassifier(indexPath);
test.after(()=>{classifier.close();rmSync(directory,{recursive:true,force:true});});

test("broad taxonomy accepts house family labels but not arbitrary title substrings",()=>{
  for(const tag of ["Detroit house","stutterhouse","Deep-House","French house","Microhouse","future house","hypnotic coastal house"])assert.equal(genreFamily(tag),"house");
  for(const tag of ["witch house","not house","Beach House"])assert.notEqual(genreFamily(tag),"house");
  assert.equal(genreFamily("UK Garage"),"adjacent");
  assert.equal(genreFamily("UK Garage",{...POLICY,familyOverrides:{...POLICY.familyOverrides,"uk garage":"house"}}),"house");
});
test("version normalization preserves different remixes, edits, instrumentals and live versions",()=>{
  assert.equal(recordingParts("Song (Original Mix)").version,"original");
  assert.equal(recordingParts("Song (Extended)").version,"extended");
  assert.notEqual(recordingParts("Song (Iris Remix)").version,recordingParts("Song (Vale Remix)").version);
  assert.notEqual(recordingParts("Song (Live)").version,recordingParts("Song (Radio Edit)").version);
  assert.equal(recordingParts("Song FEAT. Someone (Iris Remix)").base,"song");
});
test("a rapper's track-specific house evidence overrides their predominantly non-house discography",()=>{
  assert.equal(classifier.classify({artist:"Rapper",title:"Independent Dance Cut"}).category,"DEFINITELY_HOUSE");
  const unknown=classifier.classify({artist:"Rapper",title:"An Unrecognized Recording"});
  assert.equal(unknown.category,"UNKNOWN");assert.equal(unknown.review.required,true);assert.equal(unknown.review.priority,6);
});
test("house and mixed artists receive review priority; completely unknown artists stay reviewable",()=>{
  const house=classifier.classify({artist:"House DJ",title:"Unrecognized"});
  const mixed=classifier.classify({artist:"Mixed Producer",title:"Unrecognized"});
  const unknown=classifier.classify({artist:"New Underground Artist",title:"Unrecognized"});
  assert.equal(house.category,"POSSIBLY_HOUSE");assert.equal(house.review.priority,2);
  assert.equal(mixed.review.priority,3);assert.equal(unknown.category,"UNKNOWN");assert.equal(unknown.review.priority,5);
  assert.equal(reviewQueue([{result:unknown,id:1},{result:house,id:2},{result:mixed,id:3}]).length,3);
  assert.deepEqual(reviewQueue([{result:unknown,id:1},{result:house,id:2},{result:mixed,id:3}]).map(r=>r.id),[2,3,1]);
});
test("aliases work; genre evidence never leaks between named remixes",()=>{
  assert.equal(classifier.classify({artist:"House Deejay",title:"House Song 0"}).category,"DEFINITELY_HOUSE");
  assert.equal(classifier.classify({artist:"Rapper",title:"Shared Track (Iris Remix)"}).category,"DEFINITELY_HOUSE");
  assert.equal(classifier.classify({artist:"Rapper",title:"Shared Track"}).category,"NOT_HOUSE");
  const missing=classifier.classify({artist:"Rapper",title:"Shared Track (Vale Remix)"});
  assert.equal(missing.houseEvidence,false);assert.notEqual(missing.category,"DEFINITELY_HOUSE");
});
test("duration-separated recordings retain conflicts when duration is missing",()=>{
  assert.equal(classifier.classify({artist:"Mixed Producer",title:"Unmarked Version",durationMs:240000}).category,"DEFINITELY_HOUSE");
  const ambiguous=classifier.classify({artist:"Mixed Producer",title:"Unmarked Version"});
  assert.equal(ambiguous.category,"POSSIBLY_HOUSE");assert.equal(ambiguous.review.priority,1);
});
test("an untagged duration alternative prevents automatic exclusion when duration is unknown",()=>{
  const unspecified=classifier.classify({artist:"Mixed Producer",title:"Partial Metadata"});
  assert.notEqual(unspecified.category,"NOT_HOUSE");assert.equal(unspecified.review.required,true);
  assert.equal(classifier.classify({artist:"Mixed Producer",title:"Partial Metadata",durationMs:120000}).category,"NOT_HOUSE");
  assert.notEqual(classifier.classify({artist:"Mixed Producer",title:"Partial Metadata",durationMs:240000}).category,"NOT_HOUSE");
});
test("duplicate pressings do not manufacture corroboration; consistent pressings do not cause unknown",()=>{
  const unit:Unit={artist:"dj",title:"track",version:"original",duration:240000,unit:"one logical release",house:1,other:0,adjacent:0,reliability:.65,source_artist_ids:"one",sample_release:"discogs:release:1",release_count:1,tags:'["House"]'};
  const duplicates=consensus(Array.from({length:100},()=>({...unit})))[0];
  assert.equal(duplicates.units,1);assert.equal(duplicates.strong_house,0);assert.equal(duplicates.house,1);
  assert.equal(consensus([{...unit,reliability:.95},unit])[0].strong_house,1);
  assert.equal(consensus([unit,{...unit,unit:"differently named correlated release"}])[0].strong_house,0);
});
test("a track may have house and disco evidence; conflicting rock evidence requires review",()=>{
  const unit:Unit={artist:"dj",title:"track",version:"original",duration:240000,unit:"single",house:1,other:0,adjacent:1,reliability:.95,source_artist_ids:"one",sample_release:"discogs:release:1",release_count:1,tags:'["House","Disco"]'};
  assert.equal(consensus([unit])[0].strong_house,1);
  assert.equal(consensus([unit,{...unit,unit:"different",house:0,other:1,tags:'["Rock"]'}])[0].conflict,1);
});
test("manual overrides persist, require independent identification, and never affect other tracks or versions",()=>{
  const path=join(directory,"overrides.sqlite"),query={artist:"Rapper",title:"Independent Dance Cut",durationMs:240000,independentRecordingRef:"independent:test-recording"};
  let store=new Overrides(path);store.set(query,"NOT_HOUSE","independent");store.close();store=new Overrides(path);
  const rebuilt=spawnSync(process.execPath,["--experimental-transform-types","experiments/local-catalog/recall-first/build.ts",sourcePath,indexPath],{encoding:"utf8"});
  assert.equal(rebuilt.status,0,rebuilt.stdout+rebuilt.stderr);
  const withOverrides=new RecallClassifier(indexPath,store);
  assert.equal(withOverrides.classify(query).origin,"override");assert.equal(withOverrides.classify(query).category,"NOT_HOUSE");
  assert.notEqual(withOverrides.classify({...query,title:"Independent Dance Cut (Live)"}).origin,"override");
  assert.equal(withOverrides.classify({...query,independentRecordingRef:undefined}).category,"DEFINITELY_HOUSE");
  assert.throws(()=>store.set({...query,independentRecordingRef:"spotify:track:example"},"NOT_HOUSE","independent"));
  withOverrides.close();store.close();
});
test("runtime needs no network and capped non-house index retains full artist sample statistics",()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error("No runtime networking");};
  try{const result=classifier.classify({artist:"Rapper",title:"Unknown"});assert.ok(result.artist!.sampleSize>64);assert.equal(result.review.required,true);}finally{globalThis.fetch=original;}
});
