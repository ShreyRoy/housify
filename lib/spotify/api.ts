import "server-only";
import { NextResponse } from "next/server";
import { SpotifyClient } from "./client";
import { SpotifyError } from "./errors";
import { refreshSession } from "./oauth";
import { clearCookie, privateResponse, readSession, SESSION_COOKIE, writeCookie, type Session } from "./session";

export async function spotifyResponse<T>(load: (client: SpotifyClient) => Promise<T>) {
  let session: Session | null = null;
  let updated = false;
  let response: NextResponse;
  try {
    session = await readSession();
    if (!session) throw new SpotifyError(401, "Connect with Spotify to browse your library.");
    const refresh = async () => {
      session = await refreshSession(session!);
      updated = true;
      return session.accessToken;
    };
    if (session.accessExpiresAt <= Date.now() + 60_000) await refresh();
    response = NextResponse.json(await load(new SpotifyClient(session.accessToken, refresh)));
  } catch (error) {
    const problem = error instanceof SpotifyError ? error : new SpotifyError(502, "We couldn’t load your Spotify library. Please try again, or check the server configuration.");
    response = NextResponse.json({ message: problem.message, retryAfter: problem.retryAfter }, { status: problem.status });
    if (problem.retryAfter) response.headers.set("Retry-After", String(problem.retryAfter));
    if (problem.status === 401) clearCookie(response, SESSION_COOKIE);
  }
  if (updated && session && response.status !== 401) {
    writeCookie(response, SESSION_COOKIE, session, Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)));
  }
  return privateResponse(response);
}
