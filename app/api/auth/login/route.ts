import { NextRequest, NextResponse } from "next/server";
import { spotifyConfig } from "@/lib/spotify/config";
import { createPkce } from "@/lib/spotify/crypto";
import { OAUTH_COOKIE, privateResponse, writeCookie } from "@/lib/spotify/session";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const config = spotifyConfig();
    // localhost and 127.0.0.1 have different cookies. Start on the callback host.
    // NextURL normalizes 127.0.0.1 to localhost; Host preserves the browser's host.
    const origin = new URL(config.origin);
    if (request.headers.get("host") !== origin.host || request.nextUrl.protocol !== origin.protocol) return privateResponse(NextResponse.redirect(new URL("/api/auth/login", config.origin)));
    const { verifier, challenge, state } = createPkce();
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri, state, code_challenge_method: "S256", code_challenge: challenge, scope: "playlist-read-private playlist-read-collaborative" }).toString();
    const response = privateResponse(NextResponse.redirect(url));
    writeCookie(response, OAUTH_COOKIE, { state, verifier, expiresAt: Date.now() + 600_000 }, 600);
    return response;
  } catch {
    return privateResponse(NextResponse.redirect(new URL("/?auth_error=configuration", request.url)));
  }
}
