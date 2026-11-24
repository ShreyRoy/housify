// Small manifests/HEAD requests only. Never downloads a dataset archive.
import { mkdir, writeFile } from "node:fs/promises";
const headers = { "User-Agent": "HousifyResearch/0.1.0 (https://github.com/ShreyRoy/housify)" };
const output: unknown[] = [];
for (const url of [
  "https://data.discogs.com/",
  "https://data.discogs.com/?prefix=data%2F2026%2F",
  "https://data.metabrainz.org/pub/musicbrainz/data/fullexport/20261121-002203/",
  "https://data.metabrainz.org/pub/musicbrainz/data/json-dumps/",
  "https://data.metabrainz.org/pub/musicbrainz/data/json-dumps/20261121-001001/",
  "https://zenodo.org/api/records/2553414",
]) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  const chunks: Uint8Array[] = []; let bytes = 0;
  const reader = response.body?.getReader();
  if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 500000) { await reader.cancel(); throw new Error("Manifest exceeded 500 KB; stopped"); } chunks.push(value); }
  const body = Buffer.concat(chunks).toString("utf8");
  output.push({ url, status: response.status, bytes, body });
  console.log({ url, status: response.status, bytes });
}
for (const name of ["mbdump.tar.bz2", "mbdump-derived.tar.bz2"]) {
  const url = `https://data.metabrainz.org/pub/musicbrainz/data/fullexport/20261121-002203/${name}`;
  const response = await fetch(url, { method: "HEAD", headers, signal: AbortSignal.timeout(20000) });
  const entry = { url, method: "HEAD", status: response.status, compressedBytes: response.headers.get("content-length"), lastModified: response.headers.get("last-modified") };
  output.push(entry); console.log(entry);
}
await mkdir(new URL("./results/", import.meta.url), { recursive: true });
await writeFile(new URL("./results/source-manifests.json", import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), archivesDownloaded: false, observations: output }, null, 2));
