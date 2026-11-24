import { NextRequest, NextResponse } from "next/server";
import { spotifyConfig } from "@/lib/spotify/config";
import { readSession, writeCookie, clearCookie, SESSION_COOKIE, privateResponse } from "@/lib/spotify/session";
import { refreshSession } from "@/lib/spotify/oauth";
import { diagnosticsEnabled, ID, inspectSpotifyMetadata, redact, type Kind, type Observation } from "@/lib/diagnostics/spotify-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // Unavailable in the normal next start/production runtime.
  if (!diagnosticsEnabled(process.env.NODE_ENV)) return privateResponse(NextResponse.json({ message: "Not found." }, { status: 404 }));
  let session: Awaited<ReturnType<typeof readSession>> = null;
  let updated = false;
  let unauthorized = false;
  const secrets: string[] = [];
  const protect = (response: NextResponse) => {
    if (updated && session) writeCookie(response, SESSION_COOKIE, session, Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)));
    return privateResponse(response);
  };
  try {
    const config = spotifyConfig();
    const host = new URL(`http://${request.headers.get("host") || "invalid"}`).hostname;
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host) || request.headers.get("origin") !== config.origin) return privateResponse(NextResponse.json({ message: "Use this diagnostic from the configured local origin (normally http://127.0.0.1:3000)." }, { status: 403 }));
    session = await readSession();
    if (!session) return privateResponse(NextResponse.json({ message: "Log into Housify with Spotify first, then return to the diagnostic page." }, { status: 401 }));
    secrets.push(session.accessToken, session.refreshToken, process.env.SESSION_SECRET || "", process.env.SPOTIFY_CLIENT_ID || "", process.env.SPOTIFY_CLIENT_SECRET || "");
    const input = await request.text();
    if (input.length > 500) return privateResponse(NextResponse.json({ message: "Provide a playlist ID only." }, { status: 400 }));
    let playlistId: unknown;
    try { playlistId = JSON.parse(input).playlistId; } catch { /* Invalid input below. */ }
    if (typeof playlistId !== "string" || !ID.test(playlistId)) return privateResponse(NextResponse.json({ message: "A 22-character Spotify playlist ID is required." }, { status: 400 }));

    const refresh = async () => {
      session = await refreshSession(session!);
      updated = true;
      secrets.push(session.accessToken, session.refreshToken);
    };
    if (session.accessExpiresAt <= Date.now() + 60000) await refresh();
    const deadline = AbortSignal.timeout(180000);
    const get = async (path: string, kind: Kind): Promise<Observation> => {
      const url = new URL(`https://api.spotify.com/v1${path}`);
      if (url.origin !== "https://api.spotify.com" || url.searchParams.has("fields")) throw new Error("Invalid diagnostic URL");
      const perform = async (): Promise<Observation> => {
        const start = Date.now();
        try {
          const response = await fetch(url, { headers: { Authorization: `Bearer ${session!.accessToken}` }, cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, deadline, AbortSignal.timeout(15000)]) });
          const text = await response.text();
          let body: unknown = text;
          try { body = JSON.parse(text); } catch { /* Preserve the complete non-JSON error body too. */ }
          return { kind, path, status: response.status, body, elapsedMs: Date.now() - start, retryAfter: response.headers.get("Retry-After") };
        } catch {
          return { kind, path, status: null, body: null, elapsedMs: Date.now() - start, retryAfter: null, error: "Request failed, was cancelled, or exceeded its timeout. No credentials or request headers are included." };
        }
      };
      const first = await perform();
      if (first.status !== 401) return first;
      try { await refresh(); } catch { unauthorized = true; return first; }
      const retried = await perform();
      if (retried.status === 401) unauthorized = true;
      return { ...retried, beforeTokenRefresh: { status: first.status, body: first.body } };
    };
    const report = redact(await inspectSpotifyMetadata(playlistId, get), secrets);
    // Explicitly requested diagnostic output. Never log session objects, token
    // responses, environment values or HTTP request/response headers.
    console.log("[Housify development-only Spotify metadata diagnostic]\n" + JSON.stringify(report, null, 2));
    const response = NextResponse.json(report);
    if (unauthorized) { updated = false; clearCookie(response, SESSION_COOKIE); }
    return protect(response);
  } catch {
    // A refresh/configuration failure must not leak the provider's error body.
    return protect(NextResponse.json({ message: "Diagnostic could not start. Check local configuration or reconnect with Spotify. No credentials were printed." }, { status: 503 }));
  }
}
