export class SpotifyError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

export function retrySeconds(value: string | null, now = Date.now()) {
  if (!value) return 5;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, seconds) : 5;
}

export function responseError(response: Response) {
  if (response.status === 401) return new SpotifyError(401, "Your Spotify session has expired. Please connect again.");
  if (response.status === 403) return new SpotifyError(403, "Spotify denied access. In development mode, playlist items are available only for playlists you own or collaborate on. Also check your app’s user access and read permissions.");
  if (response.status === 429) return new SpotifyError(429, "Spotify is taking a breather. Please wait before trying again.", retrySeconds(response.headers.get("Retry-After")));
  if (response.status === 404) return new SpotifyError(404, "This playlist could not be found or is no longer accessible.");
  return new SpotifyError(502, "Spotify is temporarily unavailable. Please try again.");
}
