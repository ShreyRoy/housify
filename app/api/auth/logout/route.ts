import { NextRequest, NextResponse } from "next/server";
import { spotifyConfig } from "@/lib/spotify/config";
import { clearCookie, OAUTH_COOKIE, privateResponse, SESSION_COOKIE } from "@/lib/spotify/session";

export async function POST(request: NextRequest) {
  const config = spotifyConfig();
  if (request.headers.get("origin") !== config.origin) return privateResponse(NextResponse.json({ message: "Invalid request origin." }, { status: 403 }));
  const response = privateResponse(NextResponse.redirect(new URL("/", config.origin), 303));
  clearCookie(response, SESSION_COOKIE);
  clearCookie(response, OAUTH_COOKIE);
  return response;
}
