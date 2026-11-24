import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LocalCatalog } from "../catalog.ts";
import { titleParts } from "../../../lib/classification/matching.ts";

test("Python XML import → TS normalization/profiles → read-only contextual classification",()=>{
  const dir=mkdtempSync(join(tmpdir(),"housify-discogs-"));
  try{
    const xml=join(dir,"sample.xml"),db=join(dir,"catalog.sqlite");
    writeFileSync(xml,`<releases><release id="1"><artists><artist><id>1</id><name>Example Artist</name></artist></artists><title>Single</title><genres><genre>Electronic</genre></genres><styles><style>Deep House</style></styles><formats><format name="File"><descriptions><description>Single</description></descriptions></format></formats><tracklist><track><position>1</position><title>Track FEAT. Someone</title><duration>3:00</duration></track></tracklist></release></releases>`);
    const imported=spawnSync("python3",["experiments/local-catalog/discogs/import.py",xml,db,"--snapshot","2026-11-01"],{encoding:"utf8"});
    assert.equal(imported.status,0,imported.stderr+imported.stdout);
    const finalized=spawnSync(process.execPath,["--experimental-transform-types","experiments/local-catalog/discogs/prepare.ts",db],{encoding:"utf8"});
    assert.equal(finalized.status,0,finalized.stderr+finalized.stdout);
    const c=new LocalCatalog(db,undefined,true);
    const row=c.db.prepare("SELECT normalized_title FROM recordings").get()!;
    assert.equal(row.normalized_title,titleParts("Track FEAT. Someone").base);
    assert.equal(c.classify({title:"Track FEAT. Someone",artist:"Example Artist",durationMs:180000}).classification,"DEFINITELY_HOUSE");
    assert.throws(()=>c.db.prepare("DELETE FROM recordings").run());
    assert.equal(JSON.parse(readFileSync(db+".prepare.json","utf8")).checkedRecordings,1);
    c.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
