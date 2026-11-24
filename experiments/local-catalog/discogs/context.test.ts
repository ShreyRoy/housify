import test from "node:test";
import assert from "node:assert/strict";
import { LocalCatalog } from "../catalog.ts";
import { DEFAULT_POLICY } from "../policy.ts";
import type { CatalogData } from "../types.ts";

function data(tags = ["Deep House"], compilation = false): CatalogData {
  return { sources: [{id:"independent",name:"Synthetic policy test only",url:"local:test",license:"CC0-1.0",version:"1",obtainedAt:"2026-11-24"}], artists:[{id:"a",name:"Test Artist",sourceId:"independent"}],labels:[],recordings:[{id:"r",title:"Track",artistIds:["a"],isrcs:[],sourceId:"independent"}],releases:[{id:"release",title:"Single",recordingIds:["r"],labels:[],sourceId:"independent",compilation}],annotations:tags.map(genre=>({entity:"release",entityId:"release",genre,sourceId:"independent"})) };
}
function addContext(catalog: LocalCatalog, type="single", tracks=1, styles=1) {
  catalog.db.prepare("INSERT INTO release_context VALUES(?,?,?,?,?,?,?,?,?)").run("release",type,tracks,1,styles,"1","[]","https://www.discogs.com/release/1","test");
}
test("unambiguous specific house single is eligible without recording annotations",()=>{
  const c = new LocalCatalog(); c.import(data()); addContext(c);
  const result=c.classify({title:"Track",artist:"Test Artist"});
  assert.equal(result.classification,"DEFINITELY_HOUSE");
  assert.ok(result.evidence.every(e=>e.level!=="recording"));
  assert.ok(result.evidence.some(e=>e.definiteEligible&&e.sourceUrl)); c.close();
});
test("compilation, album, style conflicts and ambiguous identity cannot become definite",()=>{
  for(const [tags, compilation,type,tracks] of [[ ["House"],true,"single",1 ],[["House"],false,"album",12],[["House","Techno"],false,"single",1],[["House","Rock"],false,"single",1]] as const){
    const c=new LocalCatalog();c.import(data([...tags],compilation));addContext(c,type,tracks,tags.length);
    assert.notEqual(c.classify({title:"Track",artist:"Test Artist"}).classification,"DEFINITELY_HOUSE");c.close();
  }
  const c=new LocalCatalog();const d=data();d.recordings.push({...d.recordings[0],id:"ambiguous"});c.import(d);addContext(c);
  assert.equal(c.classify({title:"Track",artist:"Test Artist"}).classification,"UNKNOWN");c.close();
});
test("release metadata stays release-scoped; duplicate styles do not add confidence",()=>{
  const a=new LocalCatalog();a.import(data());addContext(a);
  const b=new LocalCatalog();b.import(data(["Deep House","Tech House","House"]));addContext(b,"single",1,3);
  assert.equal(a.classify({title:"Track",artist:"Test Artist"}).houseScore,b.classify({title:"Track",artist:"Test Artist"}).houseScore);
  a.close();b.close();
});
test("context promotion can be disabled and no metadata remains unknown",()=>{
  const c=new LocalCatalog(":memory:",{...DEFAULT_POLICY,context:{...DEFAULT_POLICY.context,enabled:false}});c.import(data());addContext(c);
  assert.equal(c.classify({title:"Track",artist:"Test Artist"}).classification,"POSSIBLY_HOUSE");c.close();
  const empty=new LocalCatalog();empty.import(data([]));addContext(empty,"single",1,0);
  assert.equal(empty.classify({title:"Track",artist:"Test Artist"}).classification,"UNKNOWN");empty.close();
});
test("short EP needs supported artist context, never only correlated labels",()=>{
  const c=new LocalCatalog();c.import(data());addContext(c,"ep",3);
  assert.equal(c.classify({title:"Track",artist:"Test Artist"}).classification,"POSSIBLY_HOUSE");
  const source=JSON.stringify(["independent"]);
  c.db.prepare("INSERT OR REPLACE INTO genre_distributions VALUES('artist','a','house',10,10,10,?,?)").run(JSON.stringify(c.policy),source);
  assert.equal(c.classify({title:"Track",artist:"Test Artist"}).classification,"DEFINITELY_HOUSE");c.close();
});
test("unknown styles veto release promotion and configuration must stay bounded",()=>{
  const c=new LocalCatalog();c.import(data(["House","Unrecognized Style"]));addContext(c,"single",1,2);
  c.db.prepare("INSERT INTO release_tag_kinds VALUES('release','Unrecognized Style','style')").run();
  assert.equal(c.classify({title:"Track",artist:"Test Artist"}).classification,"POSSIBLY_HOUSE");c.close();
  assert.throws(()=>new LocalCatalog(":memory:",{...DEFAULT_POLICY,context:{...DEFAULT_POLICY.context,singleWeight:2}}));
});
test("unlinked duplicate pressing candidates do not inflate profile support",()=>{
  const d=data();
  for(let i=0;i<8;i++){
    const id=`pressing-${i}`;d.recordings.push({...d.recordings[0],id});
    d.releases.push({...d.releases[0],id:`release-${i}`,recordingIds:[id]});
    d.annotations.push({...d.annotations[0],entityId:`release-${i}`});
  }
  const c=new LocalCatalog();c.import(d);
  assert.equal(c.db.prepare("SELECT tagged_recordings FROM genre_distributions WHERE entity_type='artist' AND family='house'").get()?.tagged_recordings,1);
  assert.equal(c.classify({title:"Uncatalogued",artist:"Test Artist"}).classification,"UNKNOWN");c.close();
});
