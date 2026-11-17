import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionKey, spotifyConfig } from "./config";
import { seal, unseal } from "./crypto";
import type { TokenSession } from "./token";

export const SESSION_COOKIE = "housify_session";
export const OAUTH_COOKIE = "housify_oauth";
export const SESSION_SECONDS = 60 * 60 * 24 * 30;
export type Session = TokenSession;
export type OAuthTransaction = { state: string; verifier: string; expiresAt: number };

export function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function writeCookie(response: NextResponse, name: string, value: unknown, maxAge: number) {
  const encrypted = seal(value, sessionKey(), name);
  // Fail explicitly rather than silently exceeding browsers' cookie limit.
  if (encrypted.length > 3800) throw new Error("Session exceeds cookie capacity");
  response.cookies.set(name, encrypted, { httpOnly: true, secure: spotifyConfig().secure, sameSite: "lax", path: "/", maxAge });
}

export function clearCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", { httpOnly: true, secure: spotifyConfig().secure, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function readSession(): Promise<Session | null> {
  const session = unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value, sessionKey(), SESSION_COOKIE);
  if (!session || typeof session.accessToken !== "string" || typeof session.refreshToken !== "string" || !Number.isFinite(session.accessExpiresAt) || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
  return session;
}

export async function readTransaction() {
  const transaction = unseal<OAuthTransaction>((await cookies()).get(OAUTH_COOKIE)?.value, sessionKey(), OAUTH_COOKIE);
  if (!transaction || typeof transaction.state !== "string" || typeof transaction.verifier !== "string" || !Number.isFinite(transaction.expiresAt) || transaction.expiresAt <= Date.now()) return null;
  return transaction;
}
