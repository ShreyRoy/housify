import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticsEnabled, fieldInventory, fieldState, inspectSpotifyMetadata, redact, summarize, type Kind, type Observation } from "../lib/diagnostics/spotify-metadata.ts";

const playlistId = "1111111111111111111111";
const ids = Array.from({ length: 5 }, (_, index) => String(index + 2).repeat(22));
const artistId = "8888888888888888888888";
const albumId = "9999999999999999999999";
const observation = (path: string, kind: Kind, body: unknown, status = 200): Observation => ({ path, kind, body, status, elapsedMs: 1, retryAfter: status === 429 ? "30" : null });

test("diagnostics are enabled exclusively in development", () => {
  assert.equal(diagnosticsEnabled("development"), true);
  for (const environment of ["production", "test", undefined, ""]) assert.equal(diagnosticsEnabled(environment), false);
});

test("raw five-track inspection uses single-entity URLs, no fields filters, and deduplicates artist/album requests", async () => {
  const calls: string[] = [];
  const extra = { future_field: { nested: [1, null, { unexpected: "kept" }] } };
  const report = await inspectSpotifyMetadata(playlistId, async (path, kind) => {
    calls.push(path);
    assert.equal(new URL(`https://api.spotify.com/v1${path}`).searchParams.has("fields"), false);
    if (kind === "playlist-items") return observation(path, kind, { items: ids.map(id => ({ item: { id, type: "track", artists: [{ id: artistId }], album: { id: albumId } } })), next: null });
    if (kind === "track") return observation(path, kind, { id: path.split("/").pop(), artists: [{ id: artistId }], album: { id: albumId }, external_ids: { isrc: "ZZFIX2600001" }, ...extra });
    if (kind === "artist") return observation(path, kind, { id: artistId, genres: [], arbitrary: true });
    if (kind === "album") return observation(path, kind, { id: albumId, label: "" });
    return observation(path, kind, { error: { status: 403, message: "Forbidden" } }, 403);
  });
  assert.equal(report.sampledTracks, 5);
  assert.deepEqual(report.samples.map(track => track.position), [1, 2, 3, 4, 5]);
  assert.equal(calls.filter(path => path.startsWith("/artists/")).length, 1);
  assert.equal(calls.filter(path => path.startsWith("/albums/")).length, 1);
  assert.equal(calls.filter(path => path.startsWith("/tracks/")).length, 5);
  assert.equal(calls.filter(path => path.startsWith("/audio-features/")).length, 5);
  assert.deepEqual((report.rawResponses.find(response => response.kind === "track")!.body as Record<string, unknown>).future_field, extra.future_field);
  assert.equal(report.availability.artistGenres.observations[0].field, "empty-array");
  assert.equal(report.availability.recordLabels.observations[0].field, "empty-string");
  assert.equal(report.availability.isrcs.observations[0].field, "present-string");
  assert.equal(report.availability.audioFeatures.observations[0].status, 403);
});

test("sampling skips episodes/local/missing entries and preserves original positions through pagination", async () => {
  const report = await inspectSpotifyMetadata(playlistId, async (path, kind) => {
    if (kind !== "playlist-items") return observation(path, kind, {});
    return path.includes("offset=0") ? observation(path, kind, { items: [{ item: null }, { item: { type: "episode", id: artistId } }, { item: { type: "track", id: ids[0], is_local: true } }, { item: { type: "track", id: ids[0] } }], next: `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=5&offset=4` }) : observation(path, kind, { items: ids.slice(1).map(id => ({ track: { type: "track", id } })), next: null });
  });
  assert.deepEqual(report.samples.map(track => track.position), [4, 5, 6, 7, 8]);
});

test("403 raw body survives and is not assumed to be missing scopes or proof of endpoint removal", async () => {
  const body = { error: { status: 403, message: "Not allowed for this application" }, unknown_error_field: "preserved" };
  const report = await inspectSpotifyMetadata(playlistId, async (path, kind) => observation(path, kind, body, 403));
  assert.deepEqual(report.rawResponses[0].body, body);
  assert.equal(report.sampledTracks, 0);
  assert.match(report.fieldSummary[0].endpointResult, /exact cause not established/);
  assert.equal(report.availability.artistGenres.attempted, 0);
});

test("rate limits stop subsequent probes and preserve Retry-After", async () => {
  let calls = 0;
  const report = await inspectSpotifyMetadata(playlistId, async (path, kind) => { calls++; return observation(path, kind, { error: { status: 429 } }, 429); });
  assert.equal(calls, 1);
  assert.equal(report.rawResponses[0].retryAfter, "30");
  assert.ok(report.notes.some(note => note.includes("Stopped after 429")));
});

test("empty, null, absent, false and zero are distinguished without guessing fields", () => {
  const body = { empty: [], null: null, zero: 0, false: false, blank: "", object: {} };
  assert.equal(fieldState(body, "missing"), "missing");
  assert.equal(fieldState(body, "null"), "null");
  assert.equal(fieldState(body, "empty"), "empty-array");
  assert.equal(fieldState(body, "zero"), "present-number");
  assert.equal(fieldState(body, "false"), "present-boolean");
  assert.equal(fieldState(body, "blank"), "empty-string");
  assert.equal(fieldState(body, "object"), "empty-object");
  assert.ok(fieldInventory({ arbitrary: [{ value: 0 }] }).some(field => field.path === "$.arbitrary[0].value"));
});

test("summaries mark documented deprecations separately from current observations", () => {
  const summary = summarize([observation("/artists/id", "artist", { genres: ["house"] }), observation("/artists/other", "artist", { name: "Other" })]);
  assert.equal(summary[0].checks.find(check => check.path === "genres")!.observed, "populated-array");
  assert.match(summary[0].checks.find(check => check.path === "genres")!.documentation!.status, /deprecated/);
  assert.equal(summary[1].checks.find(check => check.path === "genres")!.observed, "missing");
  assert.deepEqual(summary[1].absentComparedWithOtherSuccessfulObjects, ["genres"]);
});

test("recursive credential redaction covers error bodies, token-shaped headers and literal credentials", () => {
  const result = JSON.stringify(redact({ nested: [{ access_token: "private-token", refreshToken: "refresh", SESSION_SECRET: "key", Authorization: "Bearer abc" }], error: "accidental private-token in error", message: "Bearer another-secret", untouched: { id: "metadata", extra: [null, false, 0] } }, ["private-token", "refresh", "key"]));
  for (const credential of ["private-token", '"refresh"', '"key"', "Bearer abc", "another-secret"]) assert.ok(!result.includes(credential));
  assert.ok(result.includes("metadata"));
});

test("unexpected pagination never forwards credentials to another host", async () => {
  let calls = 0;
  const report = await inspectSpotifyMetadata(playlistId, async (path, kind) => { calls++; return observation(path, kind, { items: [], next: "https://untrusted.example/v1/me" }); });
  assert.equal(calls, 1);
  assert.ok(report.notes.some(note => note.includes("Unexpected pagination")));
});
