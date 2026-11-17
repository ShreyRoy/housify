import { spotifyResponse } from "@/lib/spotify/api";
import { playlistView, spotifyLink } from "@/lib/spotify/normalize";
import type { SpotifyPlaylist, SpotifyUser } from "@/lib/spotify/types";

export async function GET() {
  return spotifyResponse(async client => {
    const user = await client.get<SpotifyUser>("/me");
    const playlists = await client.all<SpotifyPlaylist | null>("/me/playlists?limit=50");
    return { user: { name: user.display_name || "Spotify listener", url: spotifyLink(user.external_urls?.spotify, "https://open.spotify.com") }, playlists: playlists.filter((playlist): playlist is SpotifyPlaylist => !!playlist?.id).map(playlist => playlistView(playlist, user)) };
  });
}
