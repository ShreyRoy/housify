// Offline finalization after Python import. Reuse the TypeScript taxonomy/profile
// implementation; no independent copy of genre policy is maintained in Python.
import { LocalCatalog } from "../catalog.ts";
import { normalizeName, titleParts } from "../../../lib/classification/matching.ts";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
const path=resolve(process.argv[2]||"experiments/local-catalog/discogs/artifacts/selected.sqlite");
const c=new LocalCatalog(path);
if(c.db.prepare("SELECT status FROM import_state").get()?.status!=="complete")throw new Error("Import must finish before finalization");
const start=performance.now();let checked=0,corrected=0;
// TS pure helpers are authoritative. Python normalization is an import-time
// approximation, never a second policy. Stream repairs in bounded transactions.
for(const table of ["artists","labels"] as const){
  const update=c.db.prepare(`UPDATE ${table} SET normalized_name=? WHERE id=?`);
  c.db.exec("BEGIN");
  for(const row of c.db.prepare(`SELECT id,name,normalized_name FROM ${table}`).iterate() as Iterable<{id:string;name:string;normalized_name:string}>){
    const normalized=normalizeName(row.name);if(normalized!==row.normalized_name){update.run(normalized,row.id);corrected++;}
  }
  c.db.exec("COMMIT");
}
const update=c.db.prepare("UPDATE recordings SET normalized_title=?,version=? WHERE id=?");
c.db.exec("BEGIN");
for(const row of c.db.prepare("SELECT id,title,normalized_title,version FROM recordings").iterate() as Iterable<{id:string;title:string;normalized_title:string;version:string}>){
  const parts=titleParts(row.title);
  if(parts.base!==row.normalized_title||parts.version!==row.version){update.run(parts.base,parts.version,row.id);corrected++;}
  checked++;
}
c.db.exec("COMMIT");
c.db.prepare("UPDATE sources SET obtained_at=? WHERE id LIKE 'discogs:dump:%' AND obtained_at=version").run(new Date().toISOString());
c.rebuildProfiles();
c.db.exec("ANALYZE; PRAGMA wal_checkpoint(TRUNCATE)");
c.close();
const result={checkedRecordings:checked,normalizationCorrections:corrected,normalization:"Existing TypeScript pure matching helpers, authoritative finalization",elapsedMs:performance.now()-start,peakRssBytes:process.resourceUsage().maxRSS*1024,policyScope:"Profiles describe the imported sample only; labels are not complete discographies"};
writeFileSync(path+".prepare.json",JSON.stringify(result,null,2));console.log(result);
