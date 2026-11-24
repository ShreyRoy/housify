import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { normalizeName, recordingParts } from "./policy.ts";
import type { Category, Query } from "./types.ts";
const categories=new Set(["DEFINITELY_HOUSE","POSSIBLY_HOUSE","NOT_HOUSE","UNKNOWN"]);
export class Overrides {
  private db:DatabaseSync;
  constructor(path:string){
    this.db=new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS manual_overrides(recording_key TEXT PRIMARY KEY,independent_ref TEXT NOT NULL,artist TEXT NOT NULL,title TEXT NOT NULL,version TEXT NOT NULL,duration_ms INTEGER,category TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  }
  private key(query:Query){
    const ref=query.independentRecordingRef;
    if(!ref?.trim()||/spotify[:.]|open\.spotify\.com/i.test(ref))throw new Error("An independent recording reference is required; Spotify references are outside this experiment");
    const {base,version}=recordingParts(query.title);
    if(!base||!normalizeName(query.artist))throw new Error("Artist and title are required for a recording-specific override");
    return {key:createHash("sha256").update(JSON.stringify([ref,normalizeName(query.artist),base,version,query.durationMs??null])).digest("hex"),base,version,ref};
  }
  set(query:Query,category:Category,origin:"independent"){
    if(origin!=="independent"||!categories.has(category))throw new Error("Independent metadata and a valid manual category are required");
    if(query.durationMs!==undefined&&(!Number.isFinite(query.durationMs)||query.durationMs<0))throw new Error("Invalid duration");
    const k=this.key(query);
    this.db.prepare("INSERT OR REPLACE INTO manual_overrides VALUES(?,?,?,?,?,?,?,?)").run(k.key,k.ref,normalizeName(query.artist),k.base,k.version,query.durationMs??null,category,new Date().toISOString());
  }
  get(query:Query):{category:Category;updated_at:string}|undefined{
    if(!query.independentRecordingRef)return undefined;
    return this.db.prepare("SELECT category,updated_at FROM manual_overrides WHERE recording_key=?").get(this.key(query).key) as {category:Category;updated_at:string}|undefined;
  }
  close(){this.db.close();}
}
