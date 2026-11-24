import { genreKind, normalizeTag } from "../../lib/classification/genres.ts";
import type { Family } from "./types.ts";
export type Policy = { version: string; genreOverrides: Record<string, Family>; definitelyHouse: number; notHouse: number; minArtistSupport: number; minLabelSupport: number; minProfileCoverage: number };
export const DEFAULT_POLICY: Policy = { version: "local-research-v1", genreOverrides: {}, definitelyHouse: 80, notHouse: 20, minArtistSupport: 5, minLabelSupport: 10, minProfileCoverage: .4 };
export function family(tag: string, policy: Policy): Family { return policy.genreOverrides[normalizeTag(tag)] ?? genreKind(tag).kind; }
