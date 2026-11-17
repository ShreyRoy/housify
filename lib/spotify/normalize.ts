import type { PlaylistView, SpotifyPlaylist, SpotifyPlaylistItem, SpotifyUser, TrackView } from "./types.ts";

export function spotifyLink(value: string | undefined, fallback: string | null = null): string | null {
  try { const url = new URL(value ?? ""); return url.origin === "https://open.spotify.com" && !url.username && !url.password ? url.href : fallback; } catch { return fallback; }
}

export function imageUrl(value: string | undefined): string | null {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function playlistView(playlist: SpotifyPlaylist, user: SpotifyUser): PlaylistView {
  return {
    id: playlist.id, name: playlist.name || "Untitled playlist", image: imageUrl(playlist.images?.[0]?.url),
    owner: playlist.owner?.display_name || (playlist.owner?.id === user.id ? "You" : "Spotify listener"),
    count: playlist.items?.total ?? playlist.tracks?.total ?? null,
    accessible: playlist.owner?.id === user.id || playlist.collaborative === true,
    url: spotifyLink(playlist.external_urls?.spotify, `https://open.spotify.com/playlist/${encodeURIComponent(playlist.id)}`)!,
  };
}

export function trackView(entry: SpotifyPlaylistItem | null, index: number): TrackView {
  // An explicitly null item stays unavailable; use legacy track only if item is absent.
  const item = entry?.item !== undefined ? entry.item : entry?.track;
  const isTrack = item?.type === "track";
  const local = entry?.is_local || item?.is_local;
  const status = !item ? "unavailable" : !isTrack ? "non-track" : local ? "local" : item.is_playable === false || item.restrictions ? "unavailable" : "track";
  return {
    position: index + 1, title: item?.name || "Unavailable item",
    spotifyTrackId: isTrack && item.id ? item.id : null,
    artistNames: isTrack ? (item.artists || []).map(artist => artist.name || "").filter(Boolean) : [],
    isrc: isTrack ? item.external_ids?.isrc || null : null,
    artists: isTrack ? item.artists?.map(artist => artist.name).filter(Boolean).join(", ") || "Unknown artist" : "Non-track item",
    album: isTrack ? item.album?.name || "" : "", image: isTrack ? imageUrl(item.album?.images?.[0]?.url) : null,
    duration: typeof item?.duration_ms === "number" && item.duration_ms >= 0 ? item.duration_ms : null,
    status, url: spotifyLink(item?.external_urls?.spotify),
  };
}
