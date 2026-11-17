import "server-only";
import { spotifyConfig } from "./config";
import { responseError, SpotifyError } from "./errors";
import type { Session } from "./session";

import { tokenSession, type TokenPayload } from "./token";

async function requestToken(params: Record<string, string>, prior?: Session): Promise<Session> {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: spotifyConfig().clientId }),
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) throw new SpotifyError(401, "Spotify authorization expired. Please connect again.");
    throw responseError(response);
  }
  const tokens: TokenPayload = await response.json();
  const session = tokenSession(tokens, prior);
  if (!session) throw new SpotifyError(502, "Spotify returned an incomplete authorization response.");
  return session;
}

export function exchangeCode(code: string, verifier: string) {
  return requestToken({ grant_type: "authorization_code", code, redirect_uri: spotifyConfig().redirectUri, code_verifier: verifier });
}

// Coalesce concurrent requests from the same session in this server process.
// This is only an in-flight map, not persistent token storage.
const refreshing = new Map<string, Promise<Session>>();
export async function refreshSession(session: Session) {
  const existing = refreshing.get(session.refreshToken);
  if (existing) return existing;
  const pending = requestToken({ grant_type: "refresh_token", refresh_token: session.refreshToken }, session);
  refreshing.set(session.refreshToken, pending);
  try { return await pending; } finally { refreshing.delete(session.refreshToken); }
}
