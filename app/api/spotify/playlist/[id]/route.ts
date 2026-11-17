import { spotifyResponse } from "@/lib/spotify/api";
import { SpotifyError } from "@/lib/spotify/errors";
import { playlistView, trackView } from "@/lib/spotify/normalize";
import type { SpotifyPlaylist, SpotifyPlaylistItem, SpotifyUser } from "@/lib/spotify/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return spotifyResponse(async client => {
    if (!/^[a-zA-Z0-9]{22}$/.test(id)) throw new SpotifyError(400, "That playlist ID is not valid.");
    const user = await client.get<SpotifyUser>("/me");
    const playlist = playlistView(await client.get<SpotifyPlaylist>(`/playlists/${id}`), user);
    if (!playlist.accessible) throw new SpotifyError(403, "Spotify development mode only allows track browsing for playlists you own or collaborate on. You can still open this playlist in Spotify.");
    const items = await client.all<SpotifyPlaylistItem | null>(`/playlists/${id}/items?limit=50&additional_types=track,episode`);
    return { playlist, tracks: items.map(trackView) };
  });
}
