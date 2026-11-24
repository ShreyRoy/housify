import { genreKind, normalizeTag } from "../../lib/classification/genres.ts";
import type { Family } from "./types.ts";
export type Policy = {
  version: string; genreOverrides: Record<string, Family>; definitelyHouse: number; notHouse: number;
  minArtistSupport: number; minLabelSupport: number; minProfileCoverage: number;
  weights: { recording: number; release: number; artist: number; remixer: number; label: number };
  strongEvidence: number; conflictStrength: number;
  context: { enabled: boolean; singleWeight: number; epWeight: number; albumWeight: number; ambiguousWeight: number; maxSingleTracks: number; maxEpTracks: number; maxStyles: number; minIdentity: number; minSupportingProfile: number };
};
export const DEFAULT_POLICY: Policy = {
  version: "local-context-v2", genreOverrides: {}, definitelyHouse: 80, notHouse: 20,
  minArtistSupport: 5, minLabelSupport: 10, minProfileCoverage: .4,
  weights: { recording: .9, release: .55, artist: .25, remixer: .2, label: .15 },
  strongEvidence: .7, conflictStrength: .3,
  context: { enabled: true, singleWeight: .94, epWeight: .8, albumWeight: .35, ambiguousWeight: .4, maxSingleTracks: 1, maxEpTracks: 4, maxStyles: 3, minIdentity: 95, minSupportingProfile: .18 },
};
export function family(tag: string, policy: Policy): Family { return policy.genreOverrides[normalizeTag(tag)] ?? genreKind(tag).kind; }
