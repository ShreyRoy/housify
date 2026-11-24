import test from "node:test";
import assert from "node:assert/strict";
import { LocalCatalog } from "./catalog.ts";
import { DEFAULT_POLICY } from "./policy.ts";
import type { CatalogData } from "./types.ts";

function fixture(tags: string[] = ["deep house"], count = 1): CatalogData {
  return { sources: [{ id: "test", name: "Independently authored synthetic test fixture", url: "local:test", license: "CC0-1.0", version: "1", obtainedAt: "2026-11-24" }], artists: [{ id: "artist", name: "Example Artist", sourceId: "test" }], labels: [{ id: "label", name: "Example Label", sourceId: "test" }], recordings: Array.from({ length: count }, (_, i) => ({ id: `recording-${i}`, title: `Track ${i}`, artistIds: ["artist"], sourceId: "test", isrcs: [`ZZFIX260${String(i).padStart(4, "0")}`] })), releases: Array.from({ length: count }, (_, i) => ({ id: `release-${i}`, title: `Release ${i}`, labels: ["label"], recordingIds: [`recording-${i}`], sourceId: "test" })), annotations: Array.from({ length: count }, (_, i) => tags.map(genre => ({ entity: "recording" as const, entityId: `recording-${i}`, genre, sourceId: "test" }))).flat() };
}
test("recording evidence makes explainable house/non-house decisions; missing evidence is unknown", () => {
  for (const [tags, expected] of [[["deep house"], "DEFINITELY_HOUSE"], [["rock"], "NOT_HOUSE"], [[], "UNKNOWN"], [["deep house", "rock"], "POSSIBLY_HOUSE"]] as const) {
    const catalog = new LocalCatalog(); catalog.import(fixture([...tags]));
    const result = catalog.classify({ title: "Track 0", artist: "Example Artist" });
    assert.equal(result.classification, expected);
    assert.ok(result.confidence >= 0 && result.confidence <= 100);
    assert.ok(result.metadataSources.length);
    catalog.close();
  }
});
test("release-only styles are contextual and never silently promoted to recording annotations", () => {
  const data = fixture([]); data.annotations.push({ entity: "release", entityId: "release-0", genre: "tech house", sourceId: "test" });
  const catalog = new LocalCatalog(); catalog.import(data);
  const result = catalog.classify({ title: "Track 0", artist: "Example Artist" });
  assert.equal(result.classification, "POSSIBLY_HOUSE");
  assert.ok(result.evidence.every(item => item.level !== "recording")); catalog.close();
});
test("adjacent genre policy can be changed without editing production taxonomy", () => {
  for (const [group, expected] of [["adjacent", "POSSIBLY_HOUSE"], ["house", "DEFINITELY_HOUSE"], ["other", "NOT_HOUSE"]] as const) {
    const catalog = new LocalCatalog(":memory:", { ...DEFAULT_POLICY, genreOverrides: { "uk garage": group } }); catalog.import(fixture(["UK garage"]));
    assert.equal(catalog.classify({ title: "Track 0", artist: "Example Artist" }).classification, expected); catalog.close();
  }
});
test("identifiers do not override remix, artist or title conflicts", () => {
  const data = fixture(); data.recordings[0].title = "Track 0 (Iris Remix)";
  const catalog = new LocalCatalog(); catalog.import(data);
  assert.equal(catalog.classify({ title: "Track 0", artist: "Example Artist", isrc: data.recordings[0].isrcs[0] }).classification, "UNKNOWN");
  assert.equal(catalog.classify({ title: "Track 0 (Iris Remix)", artist: "Example Artist", recordingId: "recording-0" }).classification, "DEFINITELY_HOUSE");
  assert.equal(catalog.classify({ title: "Different title", artist: "Example Artist", recordingId: "recording-0" }).classification, "UNKNOWN"); catalog.close();
});
test("ambiguous local recordings abstain rather than selecting the first row", () => {
  const data = fixture(["house"], 2); data.recordings[1].title = "Track 0";
  const catalog = new LocalCatalog(); catalog.import(data);
  assert.equal(catalog.classify({ title: "Track 0", artist: "Example Artist" }).matchedRecording, null); catalog.close();
});
test("artist/label discography fallback needs support and never makes a definite classification", () => {
  const catalog = new LocalCatalog(); catalog.import(fixture(["house"], 12));
  assert.equal(catalog.classify({ title: "Unknown song", artist: "Example Artist" }).classification, "POSSIBLY_HOUSE");
  assert.equal(catalog.classify({ title: "Unknown song", artist: "Unknown Artist", label: "Example Label" }).classification, "POSSIBLY_HOUSE");
  assert.equal(catalog.classify({ title: "Unknown song", artist: "Unknown Artist" }).classification, "UNKNOWN");
  catalog.close();
  const sparse = new LocalCatalog(); sparse.import(fixture(["house"], 2));
  assert.equal(sparse.classify({ title: "Unknown song", artist: "Example Artist" }).classification, "UNKNOWN"); sparse.close();
});
test("pressings and repeated release tracks cannot inflate artist distribution support", () => {
  const data = fixture(["house"], 2);
  for (let i = 0; i < 20; i++) data.releases.push({ ...data.releases[0], id: `copy-${i}` });
  const catalog = new LocalCatalog(); catalog.import(data);
  const row = catalog.db.prepare("SELECT tagged_recordings FROM genre_distributions WHERE entity_type='artist' AND family='house'").get()!;
  assert.equal(row.tagged_recordings, 2);
  assert.equal(catalog.classify({ title: "Unknown song", artist: "Example Artist" }).classification, "UNKNOWN"); catalog.close();
});
test("compilation styles are excluded from direct and profile fallback evidence", () => {
  const data = fixture([]); data.releases[0].compilation = true; data.annotations.push({ entity: "release", entityId: "release-0", genre: "house", sourceId: "test" });
  const catalog = new LocalCatalog(); catalog.import(data);
  assert.equal(catalog.classify({ title: "Track 0", artist: "Example Artist" }).classification, "UNKNOWN"); catalog.close();
});
test("the classifier works when every network request is forbidden", () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Runtime networking forbidden"); };
  try {
    const catalog = new LocalCatalog(); catalog.import(fixture(["house"]));
    assert.equal(catalog.classify({ title: "Track 0", artist: "Example Artist" }).classification, "DEFINITELY_HOUSE"); catalog.close();
  } finally { globalThis.fetch = original; }
});
test("remixer context stays separate from primary artist and is never sufficient for certainty", () => {
  const catalog = new LocalCatalog(); catalog.import(fixture(["house"], 6));
  const result = catalog.classify({ title: "Uncatalogued remix", artist: "Unrelated Singer", remixer: "Example Artist" });
  assert.equal(result.classification, "POSSIBLY_HOUSE");
  assert.ok(result.evidence.some(item => item.level === "remixer"));
  assert.ok(result.evidence.every(item => item.level !== "artist" && item.level !== "recording"));
  catalog.close();
});
test("score thresholds are inclusive and ISRC matches still reject contradictory duration", () => {
  const data = fixture(["house"]); data.recordings[0].durationMs = 180000;
  const base = new LocalCatalog(); base.import(data);
  const result = base.classify({ title: "Track 0", artist: "Example Artist" });
  const boundary = new LocalCatalog(":memory:", { ...DEFAULT_POLICY, definitelyHouse: result.houseScore }); boundary.import(data);
  assert.equal(boundary.classify({ title: "Track 0", artist: "Example Artist" }).classification, "DEFINITELY_HOUSE");
  const above = new LocalCatalog(":memory:", { ...DEFAULT_POLICY, definitelyHouse: result.houseScore + 1 }); above.import(data);
  assert.equal(above.classify({ title: "Track 0", artist: "Example Artist" }).classification, "POSSIBLY_HOUSE");
  assert.equal(base.classify({ title: "Track 0", artist: "Example Artist", isrc: data.recordings[0].isrcs[0], durationMs: 300000 }).matchedRecording, null);
  assert.equal(base.classify({ title: "Track 0", artist: "Example Artist", isrc: data.recordings[0].isrcs[0], durationMs: 180000 }).matchedRecording?.method, "isrc");
  base.close(); boundary.close(); above.close();
});
