import type { ClassificationTrack } from "./types.ts";

// Only minimal matching fields can enter the external lookup. Never forward
// arbitrary URLs, artwork, tokens, account data, or whole playlist objects.
export function parseAnalysisRequest(value: unknown): { track: ClassificationTrack; retry: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const input = body.track;
  if (!input || typeof input !== "object") return null;
  const track = input as Record<string, unknown>;
  const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;
  if (track.provenance !== "spotify-playlist" || !text(track.id, 100) || !/^spotify:\d+:(?:[a-zA-Z0-9]{22}|unavailable)$/.test(track.id as string) || !text(track.title, 500) || !Array.isArray(track.artists) || track.artists.length > 30 || !track.artists.every(artist => text(artist, 200))) return null;
  if (track.spotifyTrackId !== null && (typeof track.spotifyTrackId !== "string" || !/^[a-zA-Z0-9]{22}$/.test(track.spotifyTrackId))) return null;
  if (track.isrc !== undefined && (typeof track.isrc !== "string" || !/^[a-zA-Z0-9-]{12,20}$/.test(track.isrc))) return null;
  if (track.durationMs !== undefined && (typeof track.durationMs !== "number" || !Number.isFinite(track.durationMs) || track.durationMs < 0 || track.durationMs > 86400000)) return null;
  if (track.skipReason !== undefined && !text(track.skipReason, 300)) return null;
  return { track: { id: track.id as string, provenance: "spotify-playlist", spotifyTrackId: track.spotifyTrackId as string | null, title: track.title as string, artists: track.artists as string[], isrc: track.isrc as string | undefined, durationMs: track.durationMs as number | undefined, skipReason: track.skipReason as string | undefined }, retry: body.retry === true };
}
