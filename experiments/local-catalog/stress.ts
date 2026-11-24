// Synthetic engineering benchmark ONLY, not music-coverage/genre validation.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { LocalCatalog } from "./catalog.ts";
import type { CatalogData } from "./types.ts";

await mkdir(new URL("./results/", import.meta.url), { recursive: true });
const data: CatalogData = { sources: [{ id: "synthetic", name: "Independent synthetic engineering fixture", license: "CC0-1.0", url: "local:synthetic-not-music-evidence", version: "1", obtainedAt: "2026-11-24" }], artists: [], labels: [], recordings: [], releases: [], annotations: [] };
for (let i = 0; i < 100; i++) { data.artists.push({ id: `artist-${i}`, name: `Synthetic Artist ${i}`, sourceId: "synthetic" }); data.labels.push({ id: `label-${i}`, name: `Synthetic Label ${i}`, sourceId: "synthetic" }); }
for (let i = 0; i < 10000; i++) {
  data.recordings.push({ id: `synthetic-recording-${i}`, title: `Independent Engineering Track ${i} (Extended Mix)`, artistIds: [`artist-${i % 100}`], durationMs: 300000 + i, isrcs: [`ZZFIX${String(i).padStart(7, "0")}`], sourceId: "synthetic" });
  data.releases.push({ id: `release-${i}`, title: `Synthetic release ${i}`, labels: [`label-${i % 100}`], recordingIds: [`synthetic-recording-${i}`], sourceId: "synthetic" });
  data.annotations.push({ entity: "recording", entityId: `synthetic-recording-${i}`, genre: i % 3 === 0 ? "deep house" : i % 3 === 1 ? "uk garage" : "rock", sourceId: "synthetic" });
}
const file = new URL("./results/synthetic.sqlite", import.meta.url);
const db = new LocalCatalog(file.pathname);
const start = performance.now(); db.import(data); const importMs = performance.now() - start;
const times: number[] = [];
for (let i = 0; i < 5000; i++) { const index = i * 7919 % 10000; const now = performance.now(); db.classify({ title: `Independent Engineering Track ${index} (Extended Mix)`, artist: `Synthetic Artist ${index % 100}`, isrc: `ZZFIX${String(index).padStart(7, "0")}` }); times.push(performance.now() - now); }
db.close(); times.sort((a, b) => a - b);
const bytes = (await stat(file)).size;
const report = { type: "SYNTHETIC ENGINEERING ONLY; NOT COVERAGE OR ACCURACY", node: process.version, recordings: 10000, lookups: times.length, sqliteBytes: bytes, bytesPerRecording: bytes / 10000, importMs, warmMedianMs: times[Math.floor(times.length / 2)], warmP95Ms: times[Math.floor(times.length * .95)], projected100kBytesAtSameSyntheticShape: bytes * 10, limitations: "Warm single-process SQLite on this machine, deterministic synthetic names and sparse annotations; real data needs aliases, additional identifiers and richer provenance. Projections are not measured 100k-scale performance." };
await writeFile(new URL("./results/synthetic-performance.json", import.meta.url), JSON.stringify(report, null, 2)); console.log(report);
