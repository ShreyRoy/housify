import test from "node:test";
import assert from "node:assert/strict";
import { MusicBrainzHttp, MusicBrainzProvider, musicBrainzUserAgent } from "../lib/classification/musicbrainz.ts";
import { classify } from "../lib/classification/classifier.ts";
import { EnrichmentService } from "../lib/classification/enrichment.ts";
import { spotifyInput } from "../lib/classification/spotify-input.ts";
import { trackView } from "../lib/spotify/normalize.ts";
import { parseAnalysisRequest } from "../lib/classification/request.ts";
import { recordingKey } from "../lib/classification/recording-key.ts";
import { restoreLiveAnalysis, saveLiveAnalysis } from "../lib/classification/live-storage.ts";
import type { ClassificationTrack } from "../lib/classification/types.ts";

// Independent synthetic HTTP fixtures: never copied from the user's playlists.
const spotifyId = "1234567890123456789012";
const mbid = "00000000-0000-4000-8000-000000000001";
const releaseId = "00000000-0000-4000-8000-000000000002";
const contact = "https://github.com/ShreyRoy/housify";
const track: ClassificationTrack = { id: `spotify:1:${spotifyId}`, provenance: "spotify-playlist", spotifyTrackId: spotifyId, title: "Copper Horizon", artists: ["Juniper Signal"], isrc: "ZZFIX2600001", durationMs: 240000 };
const recording = { id: mbid, title: track.title, length: 240000, "artist-credit": [{ name: "Juniper Signal", artist: { name: "Juniper Signal" } }], isrcs: [track.isrc], genres: [{ name: "deep house", count: 3 }] };
const settings = { intervalMs: 2, timeoutMs: 50, retries: 0, cacheMs: 10000, maxEntries: 50 };
const options = { timeoutMs: 1000, retries: 0, cacheMs: 10000, maxEntries: 50 };
const signal = () => new AbortController().signal;
function provider(handler: (url: URL, init?: RequestInit) => Promise<Response>) {
  return new MusicBrainzProvider(new MusicBrainzHttp(musicBrainzUserAgent(contact), ((input: URL | RequestInfo, init?: RequestInit) => handler(new URL(String(input)), init)) as typeof fetch, settings));
}

test("Spotify normalization preserves IDs, ISRCs, separate artists and duplicate positions", () => {
  const item = { item: { id: spotifyId, type: "track", name: track.title, artists: [{ name: "Juniper Signal" }, { name: "Guest" }], duration_ms: 240000, external_ids: { isrc: track.isrc } } };
  const first = spotifyInput(trackView(item, 0));
  const duplicate = spotifyInput(trackView(item, 4));
  assert.equal(first.spotifyTrackId, spotifyId);
  assert.equal(first.isrc, track.isrc);
  assert.deepEqual(first.artists, ["Juniper Signal", "Guest"]);
  assert.notEqual(first.id, duplicate.id);
  assert.equal(recordingKey(first), recordingKey(duplicate));
  assert.notEqual(recordingKey(first), recordingKey({ ...first, artists: [...first.artists].reverse() }));
});

test("live ISRC → recording/release evidence → deterministic classification retains Spotify identity", async () => {
  const urls: string[] = [];
  const live = provider(async (url, init) => {
    urls.push(url.pathname);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("User-Agent"), `Housify/0.1.0 (${contact})`);
    assert.equal(headers.has("Authorization"), false);
    assert.equal(url.searchParams.has("spotifyTrackId"), false);
    if (url.pathname.includes("/isrc/")) return Response.json({ recordings: [recording] });
    if (url.pathname.includes("/recording/")) return Response.json({ ...recording, releases: [{ id: releaseId }] });
    return Response.json({ id: releaseId, genres: [{ name: "soulful house", count: 2 }] });
  });
  const metadata = await live.lookup(track, signal());
  const result = classify(track, metadata);
  assert.equal(result.spotifyTrackId, spotifyId);
  assert.equal(result.trackId, track.id);
  assert.equal(result.category, "DEFINITELY_HOUSE");
  assert.equal(result.metadataStatus, "matched");
  assert.equal(result.matchConfidence, 99);
  assert.deepEqual(metadata.evidence.map(e => e.level), ["recording", "release"]);
  assert.deepEqual(urls, [`/ws/2/isrc/${track.isrc}`, `/ws/2/recording/${mbid}`, `/ws/2/release/${releaseId}`]);
});

test("missing ISRC falls back to normalized title/artist search and remix disambiguation", async () => {
  const urls: URL[] = [];
  const remix = { ...recording, disambiguation: "Iris remix" };
  const live = provider(async url => { urls.push(url); return url.searchParams.has("query") ? Response.json({ recordings: [remix] }) : Response.json(remix); });
  const metadata = await live.lookup({ ...track, title: "Copper Horizon - Iris Remix", isrc: undefined }, signal());
  assert.equal(metadata.status, "matched");
  assert.match(urls[0].searchParams.get("query")!, /recording:"copper horizon"/);
  assert.ok(metadata.explanation.includes("title-artist"));
});

test("ambiguous or wrong-remix matches never borrow genres", async () => {
  const live = provider(async () => Response.json({ recordings: [recording] }));
  const wrong = await live.lookup({ ...track, title: "Copper Horizon - Different Remix", isrc: undefined }, signal());
  assert.equal(wrong.status, "missing");
  assert.deepEqual(wrong.evidence, []);
  const ambiguous = provider(async () => Response.json({ recordings: [recording, { ...recording, id: releaseId }] }));
  assert.equal((await ambiguous.lookup({ ...track, isrc: undefined }, signal())).status, "ambiguous");
});

test("no match, no genre tags, and external failure remain reviewable unknowns", async () => {
  const missing = await provider(async () => Response.json({ recordings: [] })).lookup(track, signal());
  assert.equal(classify(track, missing).category, "IFFY_HOUSE");
  const noTags = await provider(async url => url.pathname.includes("/isrc/") ? Response.json({ recordings: [recording] }) : Response.json({ ...recording, genres: [] })).lookup(track, signal());
  assert.equal(noTags.status, "matched");
  assert.equal(classify(track, noTags).houseConfidence, 50);
  const failure = await provider(async () => { throw new Error("Network unavailable"); }).lookup(track, signal());
  assert.equal(failure.status, "failed");
  assert.equal(failure.retryable, true);
  assert.equal(classify(track, failure).category, "IFFY_HOUSE");
});

test("unavailable slots, local files and episodes retain rows without external lookups", async () => {
  let calls = 0;
  const live = provider(async () => { calls++; throw new Error("Unexpected network request"); });
  const rows = [null, { item: { type: "episode", name: "Episode" } }, { is_local: true, item: { type: "track", name: "Local song" } }].map(trackView);
  for (const row of rows) {
    const input = spotifyInput(row);
    const result = classify(input, await live.lookup(input, signal()));
    assert.equal(result.category, "IFFY_HOUSE");
    assert.equal(result.trackId, input.id);
  }
  assert.equal(calls, 0);
});

test("successful duplicate recordings reuse metadata but keep distinct row IDs", async () => {
  let calls = 0;
  const service = new EnrichmentService(provider(async url => { calls++; return url.pathname.includes("/isrc/") ? Response.json({ recordings: [recording] }) : Response.json(recording); }), options);
  const first = classify(track, await service.lookup(track, signal()));
  const duplicate = { ...track, id: `spotify:10:${spotifyId}` };
  const second = classify(duplicate, await service.lookup(duplicate, signal()));
  assert.equal(calls, 2);
  assert.notEqual(first.trackId, second.trackId);
  assert.equal(first.spotifyTrackId, second.spotifyTrackId);
});

test("HTTP limiter spaces every request and uses a shared cache", async () => {
  const starts: number[] = [];
  const http = new MusicBrainzHttp(musicBrainzUserAgent(contact), (async () => { starts.push(Date.now()); return Response.json({ id: mbid }); }) as typeof fetch, { ...settings, intervalMs: 30 });
  await Promise.all([http.get(`recording/${mbid}`, {}, signal()), http.get(`release/${releaseId}`, {}, signal()), http.get(`recording/${mbid}`, {}, signal())]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 30);
});

test("429 Retry-After becomes a visible retryable result instead of hammering the server", async () => {
  let calls = 0;
  const live = provider(async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "60" } }); });
  const metadata = await live.lookup(track, signal());
  assert.equal(calls, 1);
  assert.equal(metadata.status, "failed");
  assert.equal(metadata.retryAfter, 60);
  assert.equal(classify(track, metadata).retryAfter, 60);
});

test("503 uses bounded retry and the Retry-After interval", async () => {
  const starts: number[] = [];
  const http = new MusicBrainzHttp(musicBrainzUserAgent(contact), (async () => { starts.push(Date.now()); return starts.length === 1 ? new Response(null, { status: 503, headers: { "Retry-After": "1" } }) : Response.json({ id: mbid }); }) as typeof fetch, { ...settings, retries: 1 });
  assert.deepEqual(await http.get(`recording/${mbid}`, {}, signal()), { id: mbid });
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 1000);
});

test("a server-wide cooldown is immediately reported to subsequent different recordings", async () => {
  let calls = 0;
  const http = new MusicBrainzHttp(musicBrainzUserAgent(contact), (async () => { calls++; return new Response(null, { status: 503, headers: { "Retry-After": "60" } }); }) as typeof fetch, settings);
  await assert.rejects(http.get(`recording/${mbid}`, {}, signal()));
  await assert.rejects(http.get(`release/${releaseId}`, {}, signal()), (error: unknown) => error instanceof Error && "retryAfter" in error && Number(error.retryAfter) >= 59);
  assert.equal(calls, 1);
});

test("HTTP timeouts and cancellation settle rather than hanging forever", async () => {
  const never = (async (_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }))) as typeof fetch;
  const http = new MusicBrainzHttp(musicBrainzUserAgent(contact), never, { ...settings, timeoutMs: 5 });
  await assert.rejects(http.get(`recording/${mbid}`, {}, signal()), /timed out/);
  const abort = new AbortController();
  const pending = http.get(`release/${releaseId}`, {}, abort.signal);
  abort.abort();
  await assert.rejects(pending);
});

test("request parsing strips unrelated data and rejects fake fixture inputs", () => {
  const parsed = parseAnalysisRequest({ track: { ...track, token: "must-not-forward", image: "https://image.example/cover.jpg" } });
  assert.ok(parsed);
  assert.equal("token" in parsed.track, false);
  assert.equal("image" in parsed.track, false);
  assert.equal(parseAnalysisRequest({ track: { ...track, provenance: "independent-fixture" } }), null);
  assert.equal(parseAnalysisRequest({ track: { ...track, spotifyTrackId: "bad" } }), null);
  assert.throws(() => musicBrainzUserAgent(undefined), /MUSICBRAINZ_CONTACT/);
});

test("live snapshots preserve decisions, expire, and invalidate on changed playlist membership/order", () => {
  const result = classify(track, { status: "missing", source: "MusicBrainz", matchConfidence: 0, evidence: [], explanation: "No match" });
  const saved = { results: { [track.id]: result }, overrides: { [track.id]: "DEFINITELY_HOUSE" as const } };
  const raw = saveLiveAnalysis("playlist-signature", saved, 1000);
  assert.deepEqual(restoreLiveAnalysis(raw, "playlist-signature", new Set([track.id]), 1001), saved);
  assert.equal(restoreLiveAnalysis(raw, "changed-playlist-signature", new Set([track.id]), 1001), null);
  assert.equal(restoreLiveAnalysis(raw, "playlist-signature", new Set([track.id]), 4000000), null);
});
