// Local endpoint smoke check. Uses an isolated synthetic session and a missing
// item; makes no Spotify or MusicBrainz request and never prints any cookie/key.
import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { seal } from "../lib/spotify/crypto.ts";

nextEnv.loadEnvConfig(process.cwd());
const target = process.env.HOUSIFY_TEST_ORIGIN || "http://127.0.0.1:3000";
const origin = new URL(process.env.SPOTIFY_REDIRECT_URI!).origin;
const url = new URL("/api/analysis/track", target);
const input = { track: { id: "spotify:1:unavailable", spotifyTrackId: null, provenance: "spotify-playlist", title: "Unavailable item", artists: [], skipReason: "No recording identity; retained for review." } };
const request = (headers: Record<string, string>, body: unknown = input) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
assert.equal((await request({ Origin: "https://foreign.example" })).status, 403);
assert.equal((await request({ Origin: origin })).status, 401);
const cookie = seal({ accessToken: "local-smoke-dummy", refreshToken: "local-smoke-dummy", accessExpiresAt: Date.now() + 60000, expiresAt: Date.now() + 60000 }, Buffer.from(process.env.SESSION_SECRET!, "base64url"), "housify_session");
const headers = { Origin: origin, Cookie: `housify_session=${cookie}` };
assert.equal((await request(headers, { track: { ...input.track, provenance: "independent-fixture" } })).status, 400);
const response = await request(headers);
assert.equal(response.status, 200);
assert.equal(response.headers.get("Cache-Control"), "private, no-store");
const result = await response.json();
assert.equal(result.category, "IFFY_HOUSE");
assert.equal(result.trackId, input.track.id);
assert.equal(result.spotifyTrackId, null);
assert.equal(result.metadataStatus, "missing");
assert.equal("accessToken" in result, false);
assert.equal("refreshToken" in result, false);
console.log("Live analysis route checks passed: origin, authentication, validation, conservative missing-item result, private caching and no token exposure. No external API was contacted.");
