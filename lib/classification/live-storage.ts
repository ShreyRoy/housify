import { ALGORITHM_VERSION } from "./classifier.ts";
import { CATEGORIES, type Category, type ClassificationResult } from "./types.ts";

export const LIVE_STORAGE_VERSION = `${ALGORITHM_VERSION}:musicbrainz-live-v1`;
export type LiveSnapshot = { results: Record<string, ClassificationResult>; overrides: Record<string, Category> };
export function saveLiveAnalysis(manifest: string, state: LiveSnapshot, now = Date.now()) {
  const templates: Omit<ClassificationResult, "trackId">[] = [];
  const unique = new Map<string, number>();
  const rows: [string, number][] = [];
  for (const [id, result] of Object.entries(state.results)) {
    const { trackId: _id, ...template } = result;
    const key = JSON.stringify(template);
    let index = unique.get(key);
    if (index === undefined) { index = templates.length; unique.set(key, index); templates.push(template); }
    rows.push([id, index]);
  }
  return JSON.stringify({ version: LIVE_STORAGE_VERSION, manifest, expires: now + 60 * 60 * 1000, templates, rows, overrides: state.overrides });
}
export function restoreLiveAnalysis(raw: string | null, manifest: string, validIds: Set<string>, now = Date.now()): LiveSnapshot | null {
  if (!raw || raw.length > 5000000) return null;
  try {
    const data = JSON.parse(raw);
    if (data.version !== LIVE_STORAGE_VERSION || data.manifest !== manifest || !Number.isFinite(data.expires) || data.expires <= now || !Array.isArray(data.rows) || data.rows.length > validIds.size || !Array.isArray(data.templates) || !data.overrides || typeof data.overrides !== "object") return null;
    for (const item of data.templates) {
      if (!item || !CATEGORIES.includes(item.category) || item.algorithmVersion !== ALGORITHM_VERSION || !(item.spotifyTrackId === null || typeof item.spotifyTrackId === "string" && /^[a-zA-Z0-9]{22}$/.test(item.spotifyTrackId)) || !Number.isFinite(item.houseConfidence) || item.houseConfidence < 0 || item.houseConfidence > 100 || !Number.isFinite(item.matchConfidence) || !Array.isArray(item.explanation) || !item.explanation.every((value: unknown) => typeof value === "string") || !Array.isArray(item.matchedSubgenres) || !item.matchedSubgenres.every((value: unknown) => typeof value === "string") || !Array.isArray(item.evidence) || !item.evidence.every((e: Record<string, unknown>) => e && typeof e.source === "string" && typeof e.tag === "string" && ["recording", "release", "artist"].includes(e.level as string)) || typeof item.metadataSource !== "string") return null;
    }
    const results: Record<string, ClassificationResult> = {};
    for (const [id, index] of data.rows) {
      if (!validIds.has(id) || !Number.isInteger(index) || !data.templates[index]) return null;
      results[id] = { ...data.templates[index], trackId: id };
    }
    for (const [id, category] of Object.entries(data.overrides)) if (!validIds.has(id) || !CATEGORIES.includes(category as Category)) return null;
    return { results, overrides: data.overrides };
  } catch { return null; }
}
