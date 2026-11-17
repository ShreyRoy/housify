import type { TrackView } from "../spotify/types.ts";
import type { ClassificationTrack } from "./types.ts";

export function spotifyInput(track: TrackView): ClassificationTrack {
  return {
    id: `spotify:${track.position}:${track.spotifyTrackId || "unavailable"}`,
    provenance: "spotify-playlist", spotifyTrackId: track.spotifyTrackId,
    title: track.title, artists: track.artistNames, durationMs: track.duration ?? undefined, isrc: track.isrc ?? undefined,
    skipReason: track.status === "non-track" ? "This entry is not a song. Retained in source order for review." : track.status === "local" ? "Local file: no reliable Spotify recording identity. Retained for manual review." : !track.spotifyTrackId || !track.artistNames.length ? "Recording identity or artist metadata is missing. Retained for manual review." : undefined,
  };
}
