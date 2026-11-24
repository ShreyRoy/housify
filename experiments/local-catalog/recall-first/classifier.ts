import { DatabaseSync } from "node:sqlite";
import { POLICY, normalizeName, recordingParts, type Policy } from "./policy.ts";
import type { ArtistRow, Category, Query, Result, TrackRow } from "./types.ts";
import type { Overrides } from "./overrides.ts";

export class RecallClassifier {
  private db:DatabaseSync;
  private tracks;private artists;
  constructor(path:string,private overrides?:Overrides,readonly policy:Policy=POLICY){
    this.db=new DatabaseSync(path,{readOnly:true});
    const stored=this.db.prepare("SELECT value FROM metadata WHERE key='policy'").get();
    if(!stored||stored.value!==JSON.stringify(policy)){this.db.close();throw new Error("Policy changed: rebuild the offline index before classification");}
    this.tracks=this.db.prepare("SELECT * FROM track_index WHERE artist=? AND title=? AND version=?");
    this.artists=this.db.prepare("SELECT * FROM artist_index WHERE lookup=?");
  }
  classify(query:Query):Result{
    if(query.durationMs!==undefined&&(!Number.isFinite(query.durationMs)||query.durationMs<0))throw new Error("Invalid duration");
    const artistKey=normalizeName(query.artist),parts=recordingParts(query.title);
    const profiles=this.artists.all(artistKey) as ArtistRow[];
    const profile=profiles.length===1?profiles[0]:null;
    const rows=[...new Set([artistKey,...profiles.map(row=>row.artist)])].flatMap(key=>this.tracks.all(key,parts.base,parts.version) as TrackRow[])
      .filter(row=>query.durationMs===undefined||row.duration_min===null||(query.durationMs>=row.duration_min-this.policy.durationToleranceMs&&query.durationMs<=row.duration_max!+this.policy.durationToleranceMs));
    const house=rows.some(row=>!!row.house),other=rows.some(row=>!!row.other),adjacent=rows.some(row=>!!row.adjacent);
    const conflict=rows.some(row=>!!row.conflict)||(house&&other)||(house&&rows.some(row=>!row.house&&!!row.adjacent));
    const manual=this.overrides?.get(query);
    let category:Category="UNKNOWN",origin:Result["origin"]="none",confidence=0;
    const explanation:string[]=[];
    const predHouse=!!profile&&profile.kind==="predominantly_house";
    const supported=!!profile&&profile.tagged>=this.policy.minArtistSupport&&profile.coverage>=this.policy.minArtistCoverage;
    const relevantArtist=supported&&profile!.house_samples>=this.policy.minHouseSupport&&profile!.house_affinity>=this.policy.meaningfulHouseAffinity;
    const electronicArtist=supported&&profile!.adjacent_affinity>=this.policy.adjacentAffinity;
    if(manual){category=manual.category;origin="override";confidence=100;explanation.push(`Independent recording-specific manual decision saved ${manual.updated_at}.`);}
    else if(rows.length&&(house||other||adjacent)){
      origin="track";
      if(house&&!conflict&&rows.every(row=>!!row.house&&!row.other)&&rows.some(row=>!!row.strong_house))category="DEFINITELY_HOUSE";
      else if(other&&!house&&!adjacent&&rows.every(row=>!!row.strong_other))category="NOT_HOUSE";
      else if(house||adjacent)category="POSSIBLY_HOUSE";
      confidence=category==="DEFINITELY_HOUSE"?90:category==="NOT_HOUSE"?95:category==="POSSIBLY_HOUSE"?conflict?55:65:0;
      explanation.push(`${rows.length} compatible precomputed version/duration groups; pressing identity is unnecessary for genre consensus.`);
      if(conflict)explanation.push("House and non-house evidence conflict; all ambiguous evidence remains reviewable.");
      if(other&&!house&&category==="UNKNOWN")explanation.push("Non-house context is insufficiently reliable for automatic exclusion.");
    }else if(predHouse||relevantArtist||electronicArtist){category="POSSIBLY_HOUSE";origin="artist";confidence=predHouse?55:35;explanation.push("Artist affinity prioritizes review; it cannot prove this recording is house.");}
    else explanation.push("Insufficient compatible track evidence. Missing metadata never causes exclusion.");
    const required=category==="POSSIBLY_HOUSE"||category==="UNKNOWN";
    let priority:number|null=null,reason="Automatic decision; available for inspection";
    if(required){
      if(conflict&&house){priority=1;reason="Conflicting track-specific house evidence";}
      else if(!rows.length&&predHouse){priority=2;reason="Unrecognized recording from a predominantly house artist";}
      else if(relevantArtist){priority=3;reason="Mixed discography with meaningful house support";}
      else if(house||adjacent||electronicArtist){priority=4;reason="Weaker house or adjacent electronic evidence";}
      else if(profile&&supported&&profile.house_affinity<this.policy.meaningfulHouseAffinity&&!electronicArtist){priority=6;reason="Unrecognized or weakly supported recording from a predominantly non-house artist";}
      else{priority=5;reason="Unknown recording; still fully accessible for review";}
    }
    explanation.push("Scores are heuristic evidence strengths, not calibrated probabilities.");
    return {category,confidence,origin,matchedGroups:rows.length,houseEvidence:house,nonHouseEvidence:other,conflictingEvidence:conflict,tags:[...new Set(rows.flatMap(row=>JSON.parse(row.tags) as string[]))].slice(0,12),provenance:rows.map(row=>JSON.parse(row.provenance)),artist:profile?{affinity:profile.house_affinity,coverage:profile.coverage,sampleSize:profile.sample_size,kind:profile.kind}:null,review:{required,priority,reason},explanation};
  }
  close(){this.db.close();}
}

export function reviewQueue<T extends {result:Result}>(rows:T[]):T[]{
  return rows.map((row,index)=>({row,index})).filter(item=>item.row.result.review.required)
    .sort((a,b)=>a.row.result.review.priority!-b.row.result.review.priority!||a.index-b.index).map(item=>item.row);
}
