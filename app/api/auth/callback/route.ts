import { NextRequest, NextResponse } from "next/server";
import { spotifyConfig } from "@/lib/spotify/config";
import { equalState } from "@/lib/spotify/crypto";
import { exchangeCode } from "@/lib/spotify/oauth";
import { clearCookie, OAUTH_COOKIE, privateResponse, readTransaction, SESSION_COOKIE, SESSION_SECONDS, writeCookie } from "@/lib/spotify/session";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  let target = request.nextUrl.origin;
  let response: NextResponse;
  try {
    const config = spotifyConfig();
    target = config.origin;
    const transaction = await readTransaction();
    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const origin = new URL(config.origin);
    if (request.headers.get("host") !== origin.host || request.nextUrl.protocol !== origin.protocol || !transaction || !state || !equalState(transaction.state, state)) {
      response = NextResponse.redirect(new URL("/?auth_error=state", target));
    } else if (request.nextUrl.searchParams.has("error")) {
      response = NextResponse.redirect(new URL("/?auth_error=denied", target));
    } else if (!code) {
      response = NextResponse.redirect(new URL("/?auth_error=callback", target));
    } else {
      const session = await exchangeCode(code, transaction.verifier);
      response = NextResponse.redirect(new URL("/dashboard", target));
      writeCookie(response, SESSION_COOKIE, session, SESSION_SECONDS);
    }
  } catch {
    response = NextResponse.redirect(new URL("/?auth_error=callback", target));
  }
  // Always discard the short-lived PKCE transaction, including on denial/errors.
  try { clearCookie(response, OAUTH_COOKIE); } catch { response.cookies.delete(OAUTH_COOKIE); }
  return privateResponse(response);
}
