import test from "node:test";
import assert from "node:assert/strict";
import { classify, DEFAULT_THRESHOLDS } from "../lib/classification/classifier.ts";
import { HOUSE_SUBGENRES } from "../lib/classification/genres.ts";
import { matchRecording } from "../lib/classification/matching.ts";
import { EnrichmentService } from "../lib/classification/enrichment.ts";
import { FixtureProvider } from "../lib/classification/providers.ts";
import { analyzeTracks } from "../lib/classification/runner.ts";
import { FIXTURE_CATALOG, FIXTURE_TRACKS, fixturePlaylist, TRANSIENT_FAILURE_ID } from "../lib/classification/fixtures.ts";
import { restoreAnalysis, saveAnalysis } from "../lib/classification/storage.ts";
import type { GenreEvidence, IndependentTrack, Metadata, MetadataProvider, RecordingCandidate } from "../lib/classification/types.ts";

const track = FIXTURE_TRACKS[0];
const metadata = (tags: string[], level: GenreEvidence["level"] = "recording", matchConfidence = 100): Metadata => ({ status: "matched", source: "Independent test fixture", matchConfidence, evidence: tags.map(tag => ({ tag, level, source: "Independent test fixture" })), explanation: "Fixture recording matched." });
const signal = () => new AbortController().signal;
const options = { timeoutMs: 50, retries: 0, cacheMs: 10000, maxEntries: 100 };

test("all supported house subgenres classify from reliable recording evidence", () => {
  for (const genre of HOUSE_SUBGENRES) {
    const result = classify(track, metadata([genre]));
    assert.equal(result.category, "DEFINITELY_HOUSE", genre);
    assert.equal(result.selectedByDefault, true);
    assert.equal(result.humanReviewRecommended, false);
    assert.ok(result.matchedSubgenres.includes(genre));
    assert.equal(result.spotifyTrackId, null);
  }
});

test("house aliases normalize punctuation and never rely on house substrings", () => {
  for (const genre of ["Deep-House", "AFROHOUSE", "French touch", "micro house", "lofi house", "jackin’ house"]) assert.equal(classify(track, metadata([genre])).category, "DEFINITELY_HOUSE", genre);
  for (const genre of ["witch house", "not house", "household", "warehouse", "melodic house & techno"]) assert.equal(classify(track, metadata([genre])).category, "IFFY_HOUSE", genre);
});

test("clearly non-house recording tags are excluded, not merely low confidence", () => {
  for (const genre of ["classical", "rock", "indie rock", "country", "hip hop", "heavy metal"]) {
    const result = classify(track, metadata([genre]));
    assert.equal(result.category, "NOT_HOUSE", genre);
    assert.equal(result.selectedByDefault, false);
    assert.ok(result.houseConfidence <= 20);
  }
});

test("adjacent genres remain reviewable rather than forced in or out", () => {
  for (const genre of ["UK garage", "techno", "trance", "drum & bass", "dubstep", "dance-pop", "amapiano", "nu disco"]) {
    const result = classify(track, metadata([genre]));
    assert.equal(result.category, "IFFY_HOUSE", genre);
    assert.equal(result.humanReviewRecommended, true);
    assert.equal(result.selectedByDefault, false);
  }
  assert.equal(classify(track, metadata(["garage house"])).category, "DEFINITELY_HOUSE");
});

test("conflicting recording or release evidence mandates review", () => {
  assert.equal(classify(track, metadata(["deep house", "rock"])).category, "IFFY_HOUSE");
  const mixed = metadata(["deep house"]);
  mixed.evidence.push(...metadata(["classical"], "release").evidence);
  const result = classify(track, mixed);
  assert.equal(result.category, "IFFY_HOUSE");
  assert.ok(result.explanation.some(text => text.includes("conflict")));
});

test("track-specific evidence outranks artist tags; a house artist's rock song is not house", () => {
  const house = metadata(["house"], "artist");
  assert.equal(classify(track, house).category, "IFFY_HOUSE");
  house.evidence.push(...metadata(["rock"]).evidence);
  assert.equal(classify(track, house).category, "NOT_HOUSE");
  assert.equal(classify(track, metadata(["deep house"], "release")).category, "IFFY_HOUSE");
});

test("missing, failed, ambiguous and blocked lookups are neutral unknowns", () => {
  for (const status of ["missing", "failed", "ambiguous", "blocked"] as const) {
    const result = classify(track, { ...metadata(["rock"]), status, evidence: [], matchConfidence: 0, retryable: status === "failed" });
    assert.equal(result.category, "IFFY_HOUSE");
    assert.equal(result.houseConfidence, 50);
    assert.equal(result.retryable, status === "failed");
  }
  assert.equal(classify(track, metadata([])).houseConfidence, 50);
  assert.equal(classify(track, metadata(["electronic"])).category, "IFFY_HOUSE");
});

test("threshold boundaries are inclusive, configurable and bounded to 0–100", () => {
  assert.equal(classify(track, metadata(["deep house"]), { ...DEFAULT_THRESHOLDS, definitelyHouse: 95 }).category, "DEFINITELY_HOUSE");
  assert.equal(classify(track, metadata(["deep house"]), { ...DEFAULT_THRESHOLDS, definitelyHouse: 96 }).category, "IFFY_HOUSE");
  assert.equal(classify(track, metadata(["rock"]), { ...DEFAULT_THRESHOLDS, notHouse: 5 }).category, "NOT_HOUSE");
  assert.equal(classify(track, metadata(["deep house"], "recording", 84)).houseConfidence, 50);
  assert.equal(classify(track, metadata(["deep house"], "recording", 85)).category, "DEFINITELY_HOUSE");
  assert.throws(() => classify(track, metadata([]), { ...DEFAULT_THRESHOLDS, definitelyHouse: 101 }));
  for (const tags of [[], ["rock"], ["deep house"], ["deep house", "rock"]]) {
    const result = classify(track, metadata(tags));
    assert.ok(result.houseConfidence >= 0 && result.houseConfidence <= 100);
  }
});

test("duplicate genre tags cannot inflate the score", () => {
  assert.equal(classify(track, metadata(["house"])).houseConfidence, classify(track, metadata(Array(100).fill("house"))).houseConfidence);
});

test("matching prefers corroborated recording IDs and ISRCs over name-only candidates", () => {
  const original = FIXTURE_CATALOG[0];
  const alternate = { ...original, id: "alternate", isrcs: [] };
  assert.equal(matchRecording(track, [alternate, original]).candidate?.id, original.id);
  assert.equal(matchRecording({ ...track, recordingId: original.id }, [alternate, original]).method, "recording-id");
  assert.equal(matchRecording(track, [{ ...original, title: "An entirely different song" }]).candidate, null);
});

test("matching preserves remixes, including versions after featured credits", () => {
  const input: IndependentTrack = { id: "independent-remix", provenance: "independent-fixture", title: "Morning Signal feat. Luma - Iris Remix", artists: ["Marble Current", "Luma"] };
  const original: RecordingCandidate = { id: "original", title: "Morning Signal", artists: ["Marble Current"], evidence: [] };
  const remix = { ...original, id: "remix", title: "Morning Signal (Iris Remix)" };
  assert.equal(matchRecording(input, [original]).candidate, null);
  assert.equal(matchRecording(input, [remix, original]).candidate?.id, "remix");
  assert.equal(matchRecording({ ...input, title: "Morning Signal - Alder Remix" }, [remix]).candidate, null);
});

test("matching handles accents, aliases, spelling differences and repeated releases conservatively", () => {
  const input: IndependentTrack = { id: "independent-title", provenance: "independent-fixture", title: "Café Satellite", artists: ["Juniper Pulze"] };
  const candidate: RecordingCandidate = { id: "candidate", title: "Cafe Satellite", artists: ["Juniper Pulse"], evidence: [] };
  assert.equal(matchRecording(input, [candidate]).candidate?.id, candidate.id);
  assert.equal(matchRecording({ ...input, artists: ["J Pulse"] }, [{ ...candidate, aliases: ["J Pulse"] }]).candidate?.id, candidate.id);
  assert.equal(matchRecording(input, [candidate, { ...candidate }]).candidate?.id, candidate.id);
  assert.equal(matchRecording(input, [candidate, { ...candidate, id: "other-recording" }]).candidate, null);
  assert.equal(matchRecording({ ...input, durationMs: 240000 }, [{ ...candidate, durationMs: 300000 }]).candidate, null);
});

test("a shared featured artist cannot match two different primary artists", () => {
  const input = { ...track, artists: ["Primary One", "Shared Guest"], isrc: undefined };
  assert.equal(matchRecording(input, [{ ...FIXTURE_CATALOG[0], artists: ["Primary Two", "Shared Guest"] }]).candidate, null);
});

test("failed enrichment can retry without losing completed cached recordings", async () => {
  const provider = new FixtureProvider(FIXTURE_CATALOG, [TRANSIENT_FAILURE_ID]);
  const service = new EnrichmentService(provider);
  const failedTrack = FIXTURE_TRACKS.find(track => track.id === TRANSIENT_FAILURE_ID)!;
  const first = await service.lookup(failedTrack, signal());
  assert.equal(first.status, "failed");
  assert.equal(classify(failedTrack, first).category, "IFFY_HOUSE");
  assert.equal((await service.lookup(failedTrack, signal(), true)).status, "matched");
});

test("duplicate requests share cached lookups, even when queued concurrently", async () => {
  let calls = 0;
  const provider: MetadataProvider = { id: "test-cache", minimumIntervalMs: 0, lookup: async () => { calls++; return metadata(["deep house"]); } };
  const service = new EnrichmentService(provider, options);
  await Promise.all([service.lookup(track, signal()), service.lookup({ ...track, id: "duplicate" }, signal())]);
  await service.lookup(track, signal(), true);
  assert.equal(calls, 1);
});

test("timeouts become retryable unknowns, with bounded retries", async () => {
  let calls = 0;
  const provider: MetadataProvider = { id: "timeout-test", minimumIntervalMs: 0, lookup: async () => { calls++; return new Promise(() => {}); } };
  const result = await new EnrichmentService(provider, { ...options, timeoutMs: 5 }).lookup(track, signal());
  assert.equal(result.status, "failed");
  assert.equal(result.retryable, true);
  assert.equal(calls, 1);
});

test("provider minimum request intervals apply across simultaneous callers", async () => {
  const starts: number[] = [];
  const provider: MetadataProvider = { id: "rate-test", minimumIntervalMs: 25, lookup: async () => { starts.push(Date.now()); return metadata([]); } };
  const service = new EnrichmentService(provider, options);
  await Promise.all([service.lookup(track, signal()), service.lookup(FIXTURE_TRACKS[1], signal()), service.lookup(FIXTURE_TRACKS[2], signal())]);
  assert.ok(starts[1] - starts[0] >= 25);
  assert.ok(starts[2] - starts[1] >= 25);
});

test("the fixture provider rejects live playlist inputs rather than substituting fiction", async () => {
  const provider = new FixtureProvider(FIXTURE_CATALOG);
  await assert.rejects(provider.lookup({ ...track, provenance: "spotify-playlist" }, signal()), /Only independent fixtures/);
});

test("cancellation preserves completed results and does not process remaining tracks", async () => {
  const abort = new AbortController();
  const completed: string[] = [];
  const service = new EnrichmentService(new FixtureProvider(FIXTURE_CATALOG));
  await assert.rejects(analyzeTracks(FIXTURE_TRACKS, service, abort.signal, result => { completed.push(result.trackId); abort.abort(); }));
  assert.deepEqual(completed, [track.id]);
});

test("runner preserves duplicates and ordering, while enrichment deduplicates", async () => {
  const entries = [track, FIXTURE_TRACKS[1], { ...track, id: "duplicate-track" }];
  const completed: string[] = [];
  await analyzeTracks(entries, new EnrichmentService(new FixtureProvider(FIXTURE_CATALOG)), signal(), result => completed.push(result.trackId));
  assert.deepEqual(completed, entries.map(track => track.id));
});

test("3,000 independent rows require only eighteen unique provider lookups", async () => {
  let lookups = 0;
  const provider: MetadataProvider = { id: "scale-test", minimumIntervalMs: 0, lookup: async () => { lookups++; return metadata(["deep house"]); } };
  const tracks = fixturePlaylist("large");
  const completed: string[] = [];
  await analyzeTracks(tracks, new EnrichmentService(provider), signal(), result => completed.push(result.trackId));
  assert.equal(lookups, 18);
  assert.equal(completed.length, 3000);
  assert.deepEqual(completed, tracks.map(track => track.id));
});

test("compact snapshots restore decisions but never initiate a new analysis", () => {
  const result = classify(track, metadata(["deep house"]));
  const saved = { size: "sample" as const, results: { [track.id]: result }, overrides: { [track.id]: "NOT_HOUSE" as const } };
  assert.deepEqual(restoreAnalysis(saveAnalysis(saved)), saved);
  assert.equal(restoreAnalysis("invalid json"), null);
  assert.equal(restoreAnalysis(saveAnalysis(saved).replace("house-rules-v1", "outdated-rules")), null);
  const repeated = fixturePlaylist("large");
  const compact = saveAnalysis({ size: "large", results: Object.fromEntries(repeated.map(track => [track.id, { ...result, trackId: track.id }])), overrides: {} });
  assert.ok(compact.length < 150000);
  assert.equal(Object.keys(restoreAnalysis(compact)!.results).length, 3000);
});
