import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createPkce, equalState, seal, unseal } from "../lib/spotify/crypto.ts";
import { SpotifyClient } from "../lib/spotify/client.ts";
import { SpotifyError, retrySeconds } from "../lib/spotify/errors.ts";
import { playlistView, trackView } from "../lib/spotify/normalize.ts";
import { tokenSession } from "../lib/spotify/token.ts";

test("PKCE uses random verifiers and a matching S256 challenge", () => {
  const a = createPkce(), b = createPkce();
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(a.challenge, createHash("sha256").update(a.verifier).digest("base64url"));
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.state, b.state);
  assert.equal(equalState(a.state, a.state), true);
  assert.equal(equalState(a.state, b.state), false);
  assert.equal(equalState(a.state, ""), false);
});

test("encrypted cookies reject tampering, different keys and different purposes", () => {
  const key = randomBytes(32), payload = { accessToken: "private-access", refreshToken: "private-refresh" };
  const cookie = seal(payload, key, "session");
  assert.ok(!cookie.includes(payload.accessToken));
  assert.deepEqual(unseal(cookie, key, "session"), payload);
  assert.equal(unseal(cookie, key, "oauth"), null);
  assert.equal(unseal(cookie, randomBytes(32), "session"), null);
  const bytes = Buffer.from(cookie, "base64url"); bytes[bytes.length - 1] ^= 1;
  assert.equal(unseal(bytes.toString("base64url"), key, "session"), null);
  assert.equal(unseal("broken", key, "session"), null);
});

test("refresh preserves an omitted refresh token, accepts rotation and preserves session expiry", () => {
  const prior = { accessToken: "old", refreshToken: "retain", accessExpiresAt: 0, expiresAt: 500000 };
  assert.deepEqual(tokenSession({ access_token: "new", expires_in: 3600, token_type: "Bearer" }, prior, 1000), { ...prior, accessToken: "new", accessExpiresAt: 3601000 });
  assert.equal(tokenSession({ access_token: "new", refresh_token: "rotated", expires_in: 3600, token_type: "Bearer" }, prior)?.refreshToken, "rotated");
  assert.equal(tokenSession({ access_token: "new", expires_in: 3600, token_type: "Bearer" }), null);
  assert.equal(tokenSession({ access_token: "new", expires_in: -1, token_type: "Bearer" }, prior), null);
});

test("pagination loads every page in order, keeping duplicates and missing slots", async () => {
  const requests: string[] = [];
  const fake = (async (input: URL | RequestInfo) => {
    requests.push(String(input));
    return Response.json(requests.length === 1 ? { items: ["a", null, "a"], next: "https://api.spotify.com/v1/playlists/test/items?offset=3" } : { items: ["b"], next: null });
  }) as typeof fetch;
  assert.deepEqual(await new SpotifyClient("access", async () => "new", fake).all("/playlists/test/items"), ["a", null, "a", "b"]);
  assert.equal(requests.length, 2);
});

test("401 refreshes once and retries with the new bearer token", async () => {
  const authorization: string[] = [];
  let refreshes = 0;
  const fake = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    authorization.push(new Headers(init?.headers).get("Authorization")!);
    return authorization.length === 1 ? new Response(null, { status: 401 }) : Response.json({ id: "me" });
  }) as typeof fetch;
  const client = new SpotifyClient("old", async () => { refreshes++; return "new"; }, fake);
  assert.deepEqual(await client.get("/me"), { id: "me" });
  assert.deepEqual(authorization, ["Bearer old", "Bearer new"]);
  assert.equal(refreshes, 1);
  let attempts = 0;
  const bad = new SpotifyClient("old", async () => "new", (async () => { attempts++; return new Response(null, { status: 401 }); }) as typeof fetch);
  await assert.rejects(bad.get("/me"), (e: unknown) => e instanceof SpotifyError && e.status === 401);
  assert.equal(attempts, 2);
});

test("403 and 429 are surfaced without request loops, including Retry-After", async () => {
  for (const status of [403, 429]) {
    let calls = 0;
    const client = new SpotifyClient("access", async () => "new", (async () => { calls++; return new Response(null, { status, headers: { "Retry-After": "42" } }); }) as typeof fetch);
    await assert.rejects(client.get("/me"), (e: unknown) => e instanceof SpotifyError && e.status === status && (status !== 429 || e.retryAfter === 42));
    assert.equal(calls, 1);
  }
  assert.equal(retrySeconds("Wed, 01 Jan 2025 00:01:00 GMT", Date.parse("2025-01-01T00:00:00Z")), 60);
  assert.equal(retrySeconds("invalid"), 5);
});

test("pagination rejects foreign origins and repeated links", async () => {
  let calls = 0;
  const client = new SpotifyClient("private", async () => "new", (async () => { calls++; return Response.json({ items: [], next: "/me/playlists" }); }) as typeof fetch);
  await assert.rejects(client.get("https://example.com/v1/me"));
  assert.equal(calls, 0);
  await assert.rejects(client.all("/me/playlists"));
  assert.equal(calls, 1);
});

test("2026 playlist fields, unknown counts and development access are accurate", () => {
  const user = { id: "me", display_name: "Listener" };
  assert.equal(playlistView({ id: "one", name: "Mine", owner: { id: "me" }, items: { total: 7 } }, user).count, 7);
  assert.equal(playlistView({ id: "one", name: "Mine", owner: { id: "me" } }, user).accessible, true);
  const other = playlistView({ id: "two", name: "Other", owner: { id: "other" } }, user);
  assert.equal(other.accessible, false);
  assert.equal(other.count, null);
  assert.equal(playlistView({ id: "three", name: "Shared", collaborative: true }, user).accessible, true);
});

test("track normalization safely preserves unavailable, local and non-track slots", () => {
  const track = { type: "track", name: "Song", artists: [{ name: "Artist" }], duration_ms: 123000, album: { name: "Album" } };
  const entries = [{ item: track }, null, { item: { type: "episode", name: "Podcast" } }, { item: track, is_local: true }, { item: { ...track, is_playable: false } }, { item: null, track }];
  const result = entries.map(trackView);
  assert.deepEqual(result.map(item => item.position), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.map(item => item.status), ["track", "unavailable", "non-track", "local", "unavailable", "unavailable"]);
  assert.equal(result[0].duration, 123000);
  assert.equal(result[1].duration, null);
  assert.equal(result[0].image, null);
});
