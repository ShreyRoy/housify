// Run against `npm run dev` or `npm start`; never follows the Spotify redirect.
import assert from "node:assert/strict";

const origin = process.env.HOUSIFY_TEST_ORIGIN || "http://127.0.0.1:3000";
const request = (path, init = {}) => fetch(new URL(path, origin), { ...init, redirect: "manual" });
const login = await request("/api/auth/login");
assert.equal(login.status, 307);
const authorization = new URL(login.headers.get("location"));
assert.equal(authorization.origin, "https://accounts.spotify.com");
assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
assert.equal(authorization.searchParams.get("response_type"), "code");
assert.equal(authorization.searchParams.get("redirect_uri"), `${origin}/api/auth/callback`);
assert.deepEqual(authorization.searchParams.get("scope").split(" ").sort(), ["playlist-read-collaborative", "playlist-read-private"]);
assert.match(authorization.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
const cookie = login.headers.get("set-cookie");
assert.match(cookie, /HttpOnly/i);
assert.match(cookie, /SameSite=lax/i);
assert.match(cookie, /Max-Age=600/i);
assert.equal(login.headers.get("cache-control"), "private, no-store");
const transaction = cookie.split(";")[0];

const mismatch = await request("/api/auth/callback?code=fake&state=incorrect", { headers: { Cookie: transaction } });
assert.equal(new URL(mismatch.headers.get("location")).searchParams.get("auth_error"), "state");
assert.match(mismatch.headers.get("set-cookie"), /Max-Age=0/i);
const denied = await request(`/api/auth/callback?error=access_denied&state=${encodeURIComponent(authorization.searchParams.get("state"))}`, { headers: { Cookie: transaction } });
assert.equal(new URL(denied.headers.get("location")).searchParams.get("auth_error"), "denied");
const missing = await request("/api/auth/callback?code=fake&state=fake");
assert.equal(new URL(missing.headers.get("location")).searchParams.get("auth_error"), "state");

for (const endpoint of ["/api/spotify/library", "/api/spotify/playlist/1234567890123456789012"]) {
  const response = await request(endpoint);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Object.keys(await response.json()), ["message"]);
}
const protectedPage = await request("/dashboard");
// App Router may already have streamed loading.tsx, then send a client redirect
// in a 200 response. Both forms must redirect without exposing library data.
if (protectedPage.status === 307) {
  assert.match(protectedPage.headers.get("location"), /auth_error=expired/);
} else {
  assert.equal(protectedPage.status, 200);
  const html = await protectedPage.text();
  assert.match(html, /NEXT_REDIRECT/);
  assert.match(html, /auth_error=expired/);
}
assert.equal((await request("/api/auth/logout", { method: "POST", headers: { Origin: "https://foreign.example" } })).status, 403);
assert.equal((await request("/api/auth/logout")).status, 405);
const logout = await request("/api/auth/logout", { method: "POST", headers: { Origin: origin } });
assert.equal(logout.status, 303);
assert.match(logout.headers.get("set-cookie"), /housify_session=;/);
assert.equal((await request("/")).status, 200);
console.log("Auth smoke checks passed: PKCE redirect, cookies, invalid/missing state, denial, protected endpoints, logout origin check, and landing page.");
