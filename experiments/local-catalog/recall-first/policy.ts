import { genreKind, normalizeTag } from "../../../lib/classification/genres.ts";
import { normalizeName, titleParts } from "../../../lib/classification/matching.ts";

export type Family = "house" | "adjacent" | "other" | "unknown";
export const POLICY = {
  version: "recall-consensus-v1",
  durationToleranceMs: 8000,
  strongSingle: .95, shortRelease: .85, album: .65,
  strongHouse: .85, strongOther: .95,
  minArtistSupport: 3, minHouseSupport: 2, minArtistCoverage: .2,
  predominantlyHouse: .65, meaningfulHouseAffinity: .05,
  adjacentAffinity: .25,
  maxNonHouseTracksPerArtist: 64,
  aliases: { "detroithouse":"detroit house", "stutterhouse":"stutter house", "lofi house":"lo fi house", "ukg":"uk garage", "d&b":"drum and bass" } as Record<string,string>,
  familyOverrides: { "detroit house":"house", "stutter house":"house", "euro house":"house", "handbag house":"house", "electronic":"adjacent", "rave":"adjacent", "big beat":"adjacent", "downtempo":"adjacent", "idm":"adjacent", "synth pop":"other", "funk":"other", "hard bop":"other", "cool jazz":"other", "modal jazz":"other", "country pop":"other", "pop rock":"other" } as Record<string,Family>,
};
export type Policy = typeof POLICY;

export function genreFamily(tag:string, policy:Policy=POLICY):Family {
  let normalized=normalizeTag(tag);
  normalized=policy.aliases[normalized]||normalized;
  if(policy.familyOverrides[normalized])return policy.familyOverrides[normalized];
  const known=genreKind(normalized).kind;
  if(known!=="unknown")return known;
  // This applies only to source genre/style labels, never track/artist names.
  // Unknown house-family names can evolve without adding each to an enum.
  if(/\b(?:witch|haunted|trap|beach|not|non|no|anti)\b/.test(normalized))return "unknown";
  return /(?:^| )house$/.test(normalized)?"house":"unknown";
}

export function recordingParts(title:string) {
  const inherited=titleParts(title);
  const suffix=title.match(/(?:[-–—]\s*|[([])([^()[\]]*\b(?:remix|mix|edit|dub|live|instrumental|version|extended|radio|original)\b[^()[\]]*)[)\]]?\s*$/i);
  const rawBase=suffix?title.slice(0,suffix.index).trim():title;
  const base=normalizeName(rawBase.split(/\s(?:feat\.?|ft\.?)\s|\s[([](?:feat\.?|ft\.?)\s/i)[0]);
  let version=normalizeName(suffix?.[1]||inherited.version);
  if(!version||["original","original mix","original version"].includes(version))version="original";
  return {base,version};
}
export { normalizeName };
