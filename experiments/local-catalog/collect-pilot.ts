// Optional, explicit research collection. Small public MusicBrainz responses
// only; no Spotify imports, credentials, audio, scraping, or dump downloads.
import { mkdir, writeFile } from "node:fs/promises";
import { BENCHMARK } from "./benchmark.ts";
import { normalizeName, titleParts, matchRecording } from "../../lib/classification/matching.ts";
import type { CatalogData, Recording } from "./types.ts";
import type { RecordingCandidate } from "../../lib/classification/types.ts";

type ArtistCredit = { name?: string; artist?: { id?: string; name?: string } };
type Tag = { name?: string; count?: number };
type MbRecording = { id: string; title: string; disambiguation?: string; length?: number; isrcs?: string[]; "artist-credit"?: ArtistCredit[]; genres?: Tag[]; tags?: Tag[]; releases?: { id: string }[] };
const started = new Date().toISOString();
const ua = "HousifyResearch/0.1.0 (https://github.com/ShreyRoy/housify)";
const catalog: CatalogData = { sources: [
  { id: "mb-core", name: "MusicBrainz community core metadata", url: "https://musicbrainz.org/doc/About/Data_License", license: "CC0-1.0", version: `API snapshot ${started}`, obtainedAt: started },
  { id: "mb-tags", name: "MusicBrainz community genre/tag associations", url: "https://musicbrainz.org/doc/About/Data_License", license: "CC-BY-NC-SA-3.0", version: `API snapshot ${started}`, obtainedAt: started },
], artists: [], labels: [], releases: [], recordings: [], annotations: [] };
const observations: Record<string, unknown>[] = [];
let requests = 0, nextStart = 0, stopped = false, responseBytes = 0;
const deadline = Date.now() + 240000;
async function get(resource: string, params: Record<string, string>, attempt = 0): Promise<any> {
  if (stopped || requests >= 70 || Date.now() >= deadline) throw new Error("Research request/deadline limit reached");
  const url = new URL(`https://musicbrainz.org/ws/2/${resource}`); url.search = new URLSearchParams({ ...params, fmt: "json" }).toString();
  while (Date.now() < nextStart) await new Promise(resolve => setTimeout(resolve, Math.min(1000, nextStart - Date.now())));
  nextStart = Date.now() + 1500; requests++;
  const response = await fetch(url, { headers: { "User-Agent": ua, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if ([429, 503].includes(response.status)) {
    const seconds = Number(response.headers.get("Retry-After") || "2");
    if (attempt < 2 && Number.isFinite(seconds) && seconds <= 5) { nextStart = Math.max(nextStart, Date.now() + Math.max(1, seconds) * 1000); return get(resource, params, attempt + 1); }
    stopped = true; throw new Error(`MusicBrainz ${response.status}; stopped after bounded retries, Retry-After=${response.headers.get("Retry-After") || "unspecified"}`);
  }
  if (!response.ok) throw new Error(`MusicBrainz HTTP ${response.status}`);
  const chunks: Uint8Array[] = []; let bytes = 0;
  const reader = response.body?.getReader();
  if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 1000000) { await reader.cancel(); throw new Error("Research response exceeded 1 MB"); } chunks.push(value); }
  responseBytes += bytes;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const quote = (value: string) => `"${value.replace(/["\\]/g, " ")}"`;
function candidate(recording: MbRecording): RecordingCandidate {
  const version = !titleParts(recording.title).version && recording.disambiguation && /\b(remix|mix|edit|dub|live|instrumental|version)\b/i.test(recording.disambiguation) ? ` (${recording.disambiguation})` : "";
  return { id: recording.id, title: recording.title + version, artists: (recording["artist-credit"] || []).map(item => item.artist?.name || item.name || "").filter(Boolean), durationMs: recording.length, isrcs: recording.isrcs, evidence: [] };
}
function addArtists(credits: ArtistCredit[]) {
  for (const credit of credits) if (credit.artist?.id && credit.artist.name && !catalog.artists.some(artist => artist.id === credit.artist!.id)) catalog.artists.push({ id: credit.artist.id, name: credit.artist.name, sourceId: "mb-core" });
  return credits.map(credit => credit.artist?.id).filter((id): id is string => !!id && catalog.artists.some(artist => artist.id === id));
}
function addTags(entity: "recording" | "release", entityId: string, genres: Tag[] = [], tags: Tag[] = []) {
  for (const name of new Set([...genres, ...tags].filter(tag => tag.name && (tag.count === undefined || tag.count > 0)).map(tag => tag.name!))) catalog.annotations.push({ entity, entityId, genre: name, sourceId: "mb-tags" });
}
for (const input of BENCHMARK) {
  const row: Record<string, unknown> = { caseId: input.id, stratum: input.stratum, artist: input.artist, title: input.title, artistMatch: null, candidateCount: null, nameVersionMatch: null, exactIdentityVerified: null, isrcAvailable: null, recordingGenres: null, releaseGenres: null, labelAvailable: null };
  try {
    const search = await get("recording/", { query: `recording:${quote(titleParts(input.title).base)} AND artist:${quote(input.artist)}`, limit: "10" });
    const recordings: MbRecording[] = search.recordings || [];
    row.candidateCount = recordings.length;
    for (const recording of recordings) addArtists(recording["artist-credit"] || []);
    row.artistMatch = recordings.some(recording => (recording["artist-credit"] || []).some(credit => normalizeName(credit.artist?.name || credit.name || "") === normalizeName(input.artist)));
    if (!row.artistMatch) {
      const artists = await get("artist/", { query: `artist:${quote(input.artist)}`, limit: "5" });
      const matches = (artists.artists || []).filter((artist: { name: string }) => normalizeName(artist.name) === normalizeName(input.artist));
      row.artistMatch = matches.length === 1;
      if (matches.length === 1) addArtists([{ artist: matches[0] }]);
    }
    const match = matchRecording({ id: input.id, provenance: "independent-fixture", title: input.title, artists: [input.artist] }, recordings.map(candidate));
    row.nameVersionMatch = false;
    row.matchConfidence = match.confidence; row.matchExplanation = match.explanation;
    if (match.candidate) {
      const details: MbRecording = await get(`recording/${match.candidate.id}`, { inc: "artist-credits+isrcs+genres+tags+releases" });
      const versioned = candidate(details);
      const confirmed = matchRecording({ id: input.id, provenance: "independent-fixture", title: input.title, artists: [input.artist] }, [versioned]);
      if (!confirmed.candidate) throw new Error("Detailed recording did not corroborate name/version match");
      const recording: Recording = { id: details.id, title: versioned.title, sourceId: "mb-core", artistIds: addArtists(details["artist-credit"] || []), durationMs: details.length, isrcs: details.isrcs || [] };
      if (!recording.artistIds.length) throw new Error("Missing primary artist identity");
      if (!catalog.recordings.some(item => item.id === recording.id)) catalog.recordings.push(recording);
      addTags("recording", recording.id, details.genres, details.tags);
      row.nameVersionMatch = true; row.matchedRecordingId = recording.id;
      row.isrcAvailable = recording.isrcs.length > 0;
      row.recordingGenres = !!details.genres?.length;
      row.recordingTags = !!details.tags?.length;
      const releaseId = details.releases?.[0]?.id;
      if (releaseId) {
        const release = await get(`release/${releaseId}`, { inc: "labels+genres+tags+release-groups" });
        const labels = (release["label-info"] || []).map((info: { label?: { id?: string; name?: string } }) => info.label).filter((label: { id?: string; name?: string } | undefined) => label?.id && label.name) as { id: string; name: string }[];
        for (const label of labels) if (!catalog.labels.some(item => item.id === label.id)) catalog.labels.push({ ...label, sourceId: "mb-core" });
        const existing = catalog.releases.find(item => item.id === releaseId);
        if (existing) { if (!existing.recordingIds.includes(recording.id)) existing.recordingIds.push(recording.id); }
        else catalog.releases.push({ id: release.id, title: release.title, sourceId: "mb-core", date: release.date, labels: labels.map(label => label.id), recordingIds: [recording.id], compilation: release["release-group"]?.["secondary-types"]?.includes("Compilation") || false });
        addTags("release", releaseId, release.genres, release.tags);
        row.labelAvailable = labels.length > 0; row.releaseGenres = !!release.genres?.length; row.releaseTags = !!release.tags?.length;
      }
    }
  } catch (error) { row.error = error instanceof Error ? error.message : "Research lookup failed"; }
  observations.push(row);
  console.log(`${observations.length}/${BENCHMARK.length} ${input.id}: artist=${row.artistMatch} recording=${row.nameVersionMatch} tags=${row.recordingGenres || row.recordingTags || row.releaseGenres || row.releaseTags}${row.error ? ` error=${row.error}` : ""}`);
}
await mkdir(new URL("./data/", import.meta.url), { recursive: true });
await mkdir(new URL("./results/", import.meta.url), { recursive: true });
await writeFile(new URL("./data/pilot-catalog.json", import.meta.url), JSON.stringify(catalog, null, 2));
await writeFile(new URL("./results/coverage-observations.json", import.meta.url), JSON.stringify({ collectedAt: started, requests, responseBytes, dataset: "Small live MusicBrainz API discovery pilot; NOT dump coverage", source: "https://musicbrainz.org", licenses: ["CC0-1.0", "CC-BY-NC-SA-3.0"], exactIdentityLimit: "No independently supplied recording IDs/ISRCs in this pilot. Name/version agreement is measured; exact recording/ISRC matching accuracy cannot be established.", observations }, null, 2));
