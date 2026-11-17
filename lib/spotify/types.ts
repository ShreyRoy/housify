export type SpotifyImage = { url: string; width?: number | null; height?: number | null };
export type SpotifyUser = { id: string; display_name: string | null; external_urls?: { spotify?: string } };
export type SpotifyPlaylist = {
  id: string;
  name: string;
  images?: SpotifyImage[] | null;
  owner?: { id?: string; display_name?: string | null };
  collaborative?: boolean;
  external_urls?: { spotify?: string };
  items?: { total?: number };
  // Optional compatibility with extended-quota responses; the endpoint is always /items.
  tracks?: { total?: number };
};
export type SpotifyTrack = {
  type: string;
  id?: string | null;
  external_ids?: { isrc?: string };
  name?: string;
  artists?: { name?: string }[];
  album?: { name?: string; images?: SpotifyImage[] };
  duration_ms?: number;
  external_urls?: { spotify?: string };
  is_playable?: boolean;
  is_local?: boolean;
  restrictions?: { reason?: string };
};
export type SpotifyPlaylistItem = {
  is_local?: boolean;
  item?: SpotifyTrack | null;
  track?: SpotifyTrack | null;
};
export type SpotifyPage<T> = { items: T[]; next: string | null; total: number; offset: number; limit: number };
export type PlaylistView = { id: string; name: string; image: string | null; owner: string; count: number | null; accessible: boolean; url: string };
export type TrackView = { position: number; spotifyTrackId: string | null; artistNames: string[]; isrc: string | null; title: string; artists: string; album: string; image: string | null; duration: number | null; status: "track" | "unavailable" | "local" | "non-track"; url: string | null };
export type LibraryData = { user: { name: string; url: string }; playlists: PlaylistView[] };
export type PlaylistData = { playlist: PlaylistView; tracks: TrackView[] };
export type ApiProblem = { message: string; retryAfter?: number };
