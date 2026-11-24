// Temporary raw-response diagnostic. No Spotify presentation types, classifier,
// normalize functions, fields projections, or enrichment providers are used.
export type JsonObject = Record<string, unknown>;
export type Kind = "playlist-items" | "track" | "artist" | "album" | "audio-features";
export type Observation = { kind: Kind; path: string; status: number | null; body: unknown; elapsedMs: number; retryAfter: string | null; error?: string; beforeTokenRefresh?: { status: number | null; body: unknown } };
export function diagnosticsEnabled(environment: string | undefined) { return environment === "development"; }
export type RawGet = (path: string, kind: Kind) => Promise<Observation>;
export const ID = /^[a-zA-Z0-9]{22}$/;
export const DOCS = {
  artist: "https://developer.spotify.com/documentation/web-api/reference/get-an-artist",
  track: "https://developer.spotify.com/documentation/web-api/reference/get-track",
  album: "https://developer.spotify.com/documentation/web-api/reference/get-an-album",
  audio: "https://developer.spotify.com/documentation/web-api/reference/get-audio-features",
  access: "https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api",
  february: "https://developer.spotify.com/documentation/web-api/references/changes/february-2026",
  march: "https://developer.spotify.com/documentation/web-api/references/changes/march-2026",
};
export function object(value: unknown): JsonObject | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

export function fieldState(value: unknown, path: string): string {
  let current = value;
  for (const key of path.split(".")) {
    const record = object(current);
    if (!record || !Object.hasOwn(record, key)) return "missing";
    current = record[key];
  }
  if (current === null) return "null";
  if (current === "") return "empty-string";
  if (Array.isArray(current)) return current.length ? "populated-array" : "empty-array";
  if (object(current)) return Object.keys(current as JsonObject).length ? "populated-object" : "empty-object";
  return `present-${typeof current}`; // false and 0 are values, not empty fields.
}

export function fieldInventory(value: unknown, prefix = "$"): { path: string; type: string; state: string }[] {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const entries = [{ path: prefix, type, state: value === null ? "null" : value === "" ? "empty-string" : Array.isArray(value) && !value.length ? "empty-array" : object(value) && !Object.keys(value as JsonObject).length ? "empty-object" : "present" }];
  if (Array.isArray(value)) value.forEach((child, index) => entries.push(...fieldInventory(child, `${prefix}[${index}]`)));
  else if (object(value)) Object.entries(value as JsonObject).forEach(([key, child]) => entries.push(...fieldInventory(child, `${prefix}.${key}`)));
  return entries;
}

// Preserve all metadata except credential fields or accidental credential values.
// Apply once more to the complete report before logging/returning it.
export function redact(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") {
    let safe = value.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
    for (const secret of secrets.filter(Boolean)) safe = safe.split(secret).join("[REDACTED]");
    return safe;
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets));
  const record = object(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, /^(?:access[_-]?token|refresh[_-]?token|client[_-]?(?:secret|id)|session[_-]?secret|authorization|cookie|set-cookie|password|credentials?)$/i.test(key) ? "[REDACTED]" : redact(item, secrets)]));
}

const expected: Partial<Record<Kind, string[]>> = {
  track: ["id", "name", "type", "uri", "href", "artists", "album", "duration_ms", "disc_number", "track_number", "explicit", "is_local", "external_urls", "external_ids", "external_ids.isrc", "available_markets", "linked_from", "popularity", "preview_url", "is_playable", "restrictions"],
  artist: ["id", "name", "type", "uri", "href", "external_urls", "images", "genres", "followers", "popularity"],
  album: ["id", "name", "type", "uri", "href", "artists", "images", "album_type", "release_date", "release_date_precision", "total_tracks", "tracks", "copyrights", "external_ids", "external_urls", "genres", "label", "popularity", "available_markets", "album_group"],
  "audio-features": ["id", "danceability", "energy", "key", "loudness", "mode", "speechiness", "acousticness", "instrumentalness", "liveness", "valence", "tempo", "duration_ms", "time_signature"],
};
function documentation(kind: Kind, field: string) {
  if (kind === "artist" && ["genres", "followers", "popularity"].includes(field)) return { status: "deprecated in current artist reference", source: DOCS.artist };
  if ((kind === "track" && ["available_markets", "linked_from", "popularity"].includes(field)) || (kind === "album" && ["album_group", "available_markets", "label", "popularity"].includes(field))) return { status: "documented removed for updated development mode; other quota modes may differ", source: DOCS.february };
  if (kind === "track" && ["external_ids", "external_ids.isrc"].includes(field)) return { status: "external_ids removal reverted; per-recording ISRC still needs observation", source: DOCS.march };
  if (kind === "track" && field === "preview_url") return { status: "deprecated; no preview audio will be fetched", source: DOCS.track };
  if (kind === "audio-features") return { status: "restricted legacy endpoint; availability is app-dependent, not inferred from OAuth scopes", source: DOCS.access };
  return null;
}

export function summarize(observations: Observation[]) {
  return observations.map(observation => {
    const successful = observation.status !== null && observation.status >= 200 && observation.status < 300;
    const peers = observations.filter(peer => peer.kind === observation.kind && peer.status !== null && peer.status >= 200 && peer.status < 300);
    const peerKeys = new Set(peers.flatMap(peer => Object.keys(object(peer.body) || {})));
    return {
      kind: observation.kind, path: observation.path, status: observation.status,
      endpointResult: successful ? "accessible" : observation.status === 403 ? "access denied; exact cause not established" : observation.status === 401 ? "unauthorized" : observation.status === 404 ? "not found or unavailable; not proof of deprecation" : observation.status === 429 ? "rate limited; further requests stopped" : observation.status === null ? "transport failure or diagnostic deadline" : "HTTP failure",
      fields: successful ? Object.keys(object(observation.body) || {}).sort() : [],
      inventory: successful ? fieldInventory(observation.body) : [],
      checks: (expected[observation.kind] || []).map(path => ({ path, observed: successful ? fieldState(observation.body, path) : "not observable: endpoint failed", documentation: documentation(observation.kind, path) })),
      absentComparedWithOtherSuccessfulObjects: successful ? [...peerKeys].filter(key => !Object.hasOwn(object(observation.body) || {}, key)).sort() : [],
    };
  });
}

export async function inspectSpotifyMetadata(playlistId: string, get: RawGet) {
  if (!ID.test(playlistId)) throw new Error("Invalid playlist ID");
  const responses: Observation[] = [];
  const notes: string[] = [];
  const samples: { position: number; trackId: string; playlistItem: unknown }[] = [];
  let halted = false;
  let requestCount = 0;
  const read = async (path: string, kind: Kind) => {
    if (halted) return null;
    if (requestCount++ >= 100) { halted = true; notes.push("Reached the 100-request safety limit; remaining endpoints were not tested."); return null; }
    const response = await get(path, kind);
    responses.push(response);
    if (response.status === 429 || response.status === 401 || response.status === null) {
      halted = true;
      notes.push(`Stopped after ${response.status ?? "a transport failure/deadline"}; unrequested endpoints are untested, not inaccessible.`);
    }
    return response;
  };

  let offset = 0;
  const seenPages = new Set<string>();
  let next: string | null = `/playlists/${playlistId}/items?limit=5&offset=0`;
  // Skip episodes/local/missing entries without assigning made-up identities.
  while (next && samples.length < 5 && !halted && seenPages.size < 20) {
    if (seenPages.has(next)) { notes.push("Repeated pagination link; stopped sampling."); break; }
    seenPages.add(next);
    const response = await read(next, "playlist-items");
    if (!response || response.status !== 200) break;
    const page = object(response.body);
    const entries = array(page?.items);
    const pageOffset = typeof page?.offset === "number" && page.offset >= 0 ? page.offset : offset;
    for (let index = 0; index < entries.length && samples.length < 5; index++) {
      const entry = object(entries[index]);
      const item = object(entry && Object.hasOwn(entry, "item") ? entry.item : entry?.track);
      if (item?.type === "track" && typeof item.id === "string" && ID.test(item.id) && !item.is_local && !entry?.is_local) samples.push({ position: pageOffset + index + 1, trackId: item.id, playlistItem: entries[index] });
    }
    offset = pageOffset + entries.length;
    if (typeof page?.next === "string") {
      const url: URL = new URL(page.next);
      if (url.origin !== "https://api.spotify.com" || url.pathname !== `/v1/playlists/${playlistId}/items` || url.searchParams.has("fields") || url.username || url.password) { notes.push("Unexpected pagination URL; sampling stopped."); break; }
      next = url.pathname.slice(3) + url.search;
    } else next = null;
  }
  if (samples.length < 5) notes.push(`Found ${samples.length} eligible tracks within the sample scan; no replacement/mock tracks were used.`);

  const artists = new Set<string>(), albums = new Set<string>();
  const collect = (value: unknown) => {
    const track = object(value);
    for (const artist of array(track?.artists)) { const id = object(artist)?.id; if (typeof id === "string" && ID.test(id)) artists.add(id); }
    const album = object(track?.album);
    if (typeof album?.id === "string" && ID.test(album.id)) albums.add(album.id);
  };
  const ids = [...new Set(samples.map(sample => sample.trackId))];
  for (const sample of samples) { const entry = object(sample.playlistItem); collect(entry && Object.hasOwn(entry, "item") ? entry.item : entry?.track); }
  for (const id of ids) { const response = await read(`/tracks/${id}`, "track"); if (response?.status === 200) collect(response.body); }
  for (const id of artists) await read(`/artists/${id}`, "artist");
  for (const id of albums) await read(`/albums/${id}`, "album");
  // Diagnostic permission probe only: never used by the classifier, no audio
  // downloads, analysis endpoint, batch endpoints, or alternative credentials.
  for (const id of ids) await read(`/audio-features/${id}`, "audio-features");

  const summary = summarize(responses);
  const availability = (kind: Kind, field?: string) => {
    const rows = summary.filter(row => row.kind === kind);
    return { attempted: rows.length, observations: rows.map(row => ({ path: row.path, status: row.status, endpointResult: row.endpointResult, field: field ? row.checks.find(check => check.path === field)?.observed : undefined })), interpretation: "Observed for this sample, token, app and time only. Missing/empty fields are not the same as endpoint denial. HTTP status alone does not establish a missing scope or an API removal." };
  };
  return {
    generatedAt: new Date().toISOString(), playlistId, requestedTracks: 5, sampledTracks: samples.length,
    requestCount: responses.length, notes,
    rawResponses: responses, samples,
    availability: { artistGenres: availability("artist", "genres"), recordLabels: availability("album", "label"), isrcs: availability("track", "external_ids.isrc"), audioFeatures: availability("audio-features") },
    fieldSummary: summary,
    documentationReviewed: "2026-11-24",
    documentationSources: DOCS,
    caveats: ["No fields filters, presentation transformations or classifier are used. Only credential redaction can alter response content.", "Missing-field checks use an explicit reference checklist and peer comparisons; they are not a complete schema or proof of a permission problem.", "The application requested playlist-read-private and playlist-read-collaborative at login. Effective endpoint access is measured, not inferred; this diagnostic does not request new scopes.", "No preview_url or audio URL is fetched. Audio features are probed only for availability at your explicit diagnostic request.", "Raw JSON is printed in the development server terminal and shown here. No report is saved automatically. Treat the report as private playlist metadata."],
  };
}
