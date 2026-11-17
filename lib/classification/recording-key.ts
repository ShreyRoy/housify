import { normalizeName } from "./matching.ts";
import type { ClassificationTrack } from "./types.ts";

export function recordingKey(track: ClassificationTrack) {
  // Keep artist order (primary artist matters) and full remix/version title.
  return JSON.stringify([track.provenance, track.recordingId || null, track.isrc || null, normalizeName(track.title), track.artists.map(normalizeName), track.durationMs ?? null, track.skipReason || null]);
}
