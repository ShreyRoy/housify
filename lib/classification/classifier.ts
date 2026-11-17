import { genreKind } from "./genres.ts";
import type { ClassificationResult, ClassificationTrack, Metadata, EvidenceLevel } from "./types.ts";

export const ALGORITHM_VERSION = "house-rules-v1";
export const DEFAULT_THRESHOLDS = { definitelyHouse: 80, notHouse: 20, minimumMatch: 85, decisiveEvidence: .6 };
export type Thresholds = typeof DEFAULT_THRESHOLDS;
const weights: Record<EvidenceLevel, number> = { recording: .9, release: .55, artist: .12 };

export function classify(track: ClassificationTrack, metadata: Metadata, thresholds: Thresholds = DEFAULT_THRESHOLDS): ClassificationResult {
  if (!(thresholds.notHouse >= 0 && thresholds.definitelyHouse <= 100 && thresholds.notHouse < 50 && thresholds.definitelyHouse > 50 && thresholds.minimumMatch >= 0 && thresholds.minimumMatch <= 100 && thresholds.decisiveEvidence > 0 && thresholds.decisiveEvidence <= 1)) throw new Error("Invalid classifier thresholds");
  const explanation = [metadata.explanation];
  const result: ClassificationResult = {
    trackId: track.id, spotifyTrackId: track.provenance === "spotify-playlist" ? track.spotifyTrackId ?? null : null, category: "IFFY_HOUSE", houseConfidence: 50,
    matchedSubgenres: [], explanation, metadataSource: metadata.source, matchConfidence: metadata.matchConfidence,
    humanReviewRecommended: true, selectedByDefault: false, metadataStatus: metadata.status,
    retryable: metadata.retryable === true, ...(metadata.retryAfter ? { retryAfter: metadata.retryAfter } : {}), evidence: metadata.evidence, algorithmVersion: ALGORITHM_VERSION,
  };
  if (metadata.status !== "matched" || !Number.isFinite(metadata.matchConfidence) || metadata.matchConfidence < thresholds.minimumMatch || metadata.matchConfidence > 100) {
    explanation.push("No sufficiently reliable genre match. Missing, failed or blocked lookups are uncertainty, never evidence against house.");
    return result;
  }
  const strengths = { house: { recording: 0, release: 0, artist: 0 }, other: { recording: 0, release: 0, artist: 0 }, adjacent: { recording: 0, release: 0, artist: 0 } };
  const reliability = Math.min(100, Math.max(0, metadata.matchConfidence)) / 100;
  for (const evidence of metadata.evidence) {
    const genre = genreKind(evidence.tag);
    if (genre.kind === "unknown") continue;
    const weight = weights[evidence.level] * genre.specificity * reliability;
    strengths[genre.kind][evidence.level] = Math.max(strengths[genre.kind][evidence.level], weight);
    if (genre.kind === "house" && !result.matchedSubgenres.includes(genre.canonical)) result.matchedSubgenres.push(genre.canonical);
    explanation.push(`${evidence.level}: “${evidence.tag}” is ${genre.kind === "house" ? "house-family evidence" : genre.kind === "adjacent" ? "adjacent, not decisive" : "non-house evidence"} (${evidence.source}).`);
  }
  // Max within each level prevents tag stuffing; combine the three levels once.
  const combine = (values: Record<EvidenceLevel, number>) => 1 - (1 - values.recording) * (1 - values.release) * (1 - values.artist);
  const positive = combine(strengths.house), negative = combine(strengths.other), adjacent = combine(strengths.adjacent);
  result.houseConfidence = Math.round(Math.min(100, Math.max(0, 50 + 50 * positive - 50 * negative - 15 * adjacent)));
  const conflict = positive >= .3 && negative >= .3;
  const decisiveHouse = strengths.house.recording >= thresholds.decisiveEvidence;
  const decisiveOther = strengths.other.recording >= thresholds.decisiveEvidence;
  if (!conflict && decisiveHouse && result.houseConfidence >= thresholds.definitelyHouse) result.category = "DEFINITELY_HOUSE";
  else if (!conflict && decisiveOther && result.houseConfidence <= thresholds.notHouse) result.category = "NOT_HOUSE";
  if (conflict) explanation.push("Reliable house and non-house tags conflict; manual review is required.");
  if (!metadata.evidence.length) explanation.push("The recording matched, but has no genre tags. Kept for review.");
  if (!decisiveHouse && !decisiveOther && metadata.evidence.length) explanation.push("Release-only, artist-only, adjacent or unrecognized tags cannot determine a recording’s genre.");
  explanation.push(`Heuristic score ${result.houseConfidence}/100; neutral baseline 50, recording weight 0.90, release 0.55, artist 0.12. This is not a probability.`);
  result.humanReviewRecommended = result.category === "IFFY_HOUSE";
  result.selectedByDefault = result.category === "DEFINITELY_HOUSE";
  return result;
}
