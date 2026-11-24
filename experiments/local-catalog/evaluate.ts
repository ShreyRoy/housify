// Fully offline. Run collect-pilot.ts explicitly once to provide the small
// independently sourced pilot catalog; this command never fetches metadata.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { LocalCatalog } from "./catalog.ts";
import { BENCHMARK } from "./benchmark.ts";
import type { CatalogData } from "./types.ts";

const dir = new URL("./results/", import.meta.url);
await mkdir(dir, { recursive: true });
const data: CatalogData = JSON.parse(await readFile(new URL("./data/pilot-catalog.json", import.meta.url), "utf8"));
const observations = JSON.parse(await readFile(new URL("./results/coverage-observations.json", import.meta.url), "utf8"));
const catalog = new LocalCatalog();
const start = performance.now(); catalog.import(data);
const importMs = performance.now() - start;
const rows = BENCHMARK.map(item => ({ caseId: item.id, stratum: item.stratum, title: item.title, artist: item.artist, gold: item.gold, result: catalog.classify({ title: item.title, artist: item.artist }) }));
const eligible = rows.filter(row => row.gold?.scope === "recording");
const falsePositives = eligible.filter(row => row.gold!.family !== "house" && row.result.classification === "DEFINITELY_HOUSE");
const falseNegatives = eligible.filter(row => row.gold!.family === "house" && row.result.classification === "NOT_HOUSE");
const goldHouse = eligible.filter(row => row.gold!.family === "house");
const truePositives = goldHouse.filter(row => row.result.classification === "DEFINITELY_HOUSE");
const predictedPositives = eligible.filter(row => row.result.classification === "DEFINITELY_HOUSE");
const counts = (items: Record<string, unknown>[]) => Object.fromEntries(["artistMatch", "nameVersionMatch", "isrcAvailable", "recordingGenres", "recordingTags", "releaseGenres", "releaseTags", "labelAvailable"].map(key => [key, { available: items.filter(row => row[key] === true).length, observed: items.filter(row => typeof row[key] === "boolean").length, unavailable: items.filter(row => row[key] === false).length }]));
const runTimes: number[] = [];
for (let round = 0; round < 20; round++) for (const item of BENCHMARK) { const now = performance.now(); catalog.classify({ title: item.title, artist: item.artist }); runTimes.push(performance.now() - now); }
runTimes.sort((a, b) => a - b);
const target = new URL("./results/pilot.sqlite", import.meta.url);
const disk = new LocalCatalog(target.pathname); disk.import(data); disk.close();
catalog.close();
const report = {
  generatedAt: new Date().toISOString(), design: "18 purposively selected public recordings; incomplete independent gold review; NOT a random 100-track benchmark or full-dump coverage evaluation",
  discovery: { ...counts(observations.observations), byStratum: Object.fromEntries(["mainstream", "underground", "recent", "adjacent", "unrelated"].map(stratum => [stratum, counts(observations.observations.filter((row: { stratum: string }) => row.stratum === stratum))])), exactRecordingMatchRate: null, exactRecordingMatchReason: "No independently verified recording IDs/durations for exact-identity gold. Name/version candidate matches are a proxy only.", isrcMatchRate: null, isrcMatchReason: "ISRC availability is observed on matched records; no gold input ISRCs were available to measure ISRC matching accuracy.", requests: observations.requests, responseBytes: observations.responseBytes },
  evaluation: { strictGoldRows: eligible.length, totalRows: rows.length, falsePositives: falsePositives.map(row => row.caseId), falseNegatives: falseNegatives.map(row => row.caseId), goldHouseAbstentions: goldHouse.filter(row => ["UNKNOWN", "POSSIBLY_HOUSE"].includes(row.result.classification)).map(row => row.caseId), definiteHouseRecallIncludingAbstentions: goldHouse.length ? truePositives.length / goldHouse.length : null, definiteHousePrecision: predictedPositives.length ? truePositives.length / predictedPositives.length : null, limitation: "No errors among abstentions is not high accuracy. Provisional/release-level/unadjudicated gold excluded. Local catalog was selected using these queries: not a held-out retrieval test." },
  local: { sqliteBytes: (await stat(target)).size, recordings: data.recordings.length, artists: data.artists.length, labels: data.labels.length, releases: data.releases.length, importMs, warmLookupRuns: runTimes.length, warmMedianMs: runTimes[Math.floor(runTimes.length / 2)], warmP95Ms: runTimes[Math.floor(runTimes.length * .95)], caveat: "Tiny tailored in-memory pilot; warm timings do not predict cold disk or full-catalog latency." },
  rows,
};
await writeFile(new URL("./results/pilot-results.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ discovery: report.discovery, evaluation: report.evaluation, local: report.local, decisions: rows.map(row => ({ id: row.caseId, classification: row.result.classification })) }, null, 2));
