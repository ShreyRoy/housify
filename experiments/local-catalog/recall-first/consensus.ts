import { createHash } from "node:crypto";
import { POLICY, genreFamily, type Policy } from "./policy.ts";
import type { TrackRow } from "./types.ts";

export type Unit={artist:string;title:string;version:string;duration:number|null;unit:string;house:number;other:number;adjacent:number;reliability:number;source_artist_ids:string;sample_release:string;release_count:number;tags:string};
export function consensus(input:Unit[],policy:Policy=POLICY):TrackRow[]{
  if(!input.length)return [];
  const sorted=[...input].sort((a,b)=>(a.duration??-1)-(b.duration??-1));
  const clusters:Unit[][]=[];
  for(const row of sorted){
    const last=clusters[clusters.length-1];
    if(!last||last[0].duration===null&&row.duration!==null||last[0].duration!==null&&row.duration!==null&&row.duration-last[0].duration>policy.durationToleranceMs)clusters.push([row]);
    else last.push(row);
  }
  return clusters.map((cluster,index)=>{
    const units=new Map<string,Unit>();
    for(const row of cluster){
      const old=units.get(row.unit);
      if(!old)units.set(row.unit,{...row});
      else{old.house=Math.max(old.house,row.house);old.other=Math.max(old.other,row.other);old.adjacent=Math.max(old.adjacent,row.adjacent);old.reliability=Math.max(old.reliability,row.reliability);old.release_count+=row.release_count;}
    }
    const votes=[...units.values()],known=votes.filter(v=>v.house||v.other||v.adjacent);
    const house=votes.filter(v=>v.house),other=votes.filter(v=>v.other),adjacent=votes.some(v=>v.adjacent);
    const specificAdjacentWithoutHouse=votes.some(v=>!v.house&&v.adjacent&&(JSON.parse(v.tags) as string[]).some(tag=>genreFamily(tag,policy)==="adjacent"&&!/^(electronic|electronic dance music|rave|disco|nu disco)$/i.test(tag)));
    const conflict=house.length>0&&(other.length>0||specificAdjacentWithoutHouse);
    const maxHouse=Math.max(0,...house.filter(v=>!v.other).map(v=>v.reliability));
    const maxOther=Math.max(0,...other.filter(v=>!v.house&&!v.adjacent).map(v=>v.reliability));
    const coherentHouse=house.length>0&&!conflict;
    const coherentOther=other.length>0&&other.length===known.length&&!house.length&&!adjacent;
    return {artist:input[0].artist,title:input[0].title,version:input[0].version,cluster:index,duration_min:cluster[0].duration,duration_max:cluster[cluster.length-1].duration,
      house:+!!house.length,other:+!!other.length,adjacent:+adjacent,conflict:+conflict,
      // Counts are provenance only. Even differently named copies cannot turn
      // weak album context into certainty through repeated votes.
      strong_house:+(coherentHouse&&maxHouse>=policy.strongHouse),
      strong_other:+(coherentOther&&maxOther>=policy.strongOther),
      units:votes.length,house_units:house.length,other_units:other.length,
      tags:JSON.stringify([...new Set(votes.flatMap(v=>JSON.parse(v.tags) as string[]))].slice(0,12)),
      provenance:JSON.stringify({source:"Discogs bulk metadata",scope:"release context",logicalReleaseUnits:votes.length,sourceReleaseObservations:votes.reduce((n,v)=>n+v.release_count,0),releaseIds:[...new Set(votes.map(v=>v.sample_release))].slice(0,3),deduplication:"Logical release title + artist, not pressing count; not proof of independent recording identity"})};
  });
}
export function retentionRank(row:TrackRow){
  return {quality:row.strong_other*100000+Math.min(row.units,99999),tie:createHash("sha256").update(JSON.stringify([row.artist,row.title,row.version,row.duration_min,row.duration_max])).digest("hex")};
}
