import { ALGORITHM_VERSION } from "./classifier.ts";
import { FIXTURE_VERSION } from "./fixtures.ts";
import { CATEGORIES, type Category, type ClassificationResult } from "./types.ts";

export type SavedAnalysis = { size: "sample" | "large"; results: Record<string, ClassificationResult>; overrides: Record<string, Category> };
const version = `${FIXTURE_VERSION}:${ALGORITHM_VERSION}:1`;
export const STORAGE_KEY = "housify-independent-analysis-v1";

// Deduplicate repeated recording results before browser storage, so the large
// fixture keeps 18 result templates rather than 3,000 long explanations.
export function saveAnalysis(state: SavedAnalysis): string {
  const templates: Omit<ClassificationResult, "trackId">[] = [];
  const keys = new Map<string, number>();
  const entries: [string, number][] = [];
  for (const [id, result] of Object.entries(state.results)) {
    const { trackId: _id, ...template } = result;
    const key = JSON.stringify(template);
    let index = keys.get(key);
    if (index === undefined) { index = templates.length; keys.set(key, index); templates.push(template); }
    entries.push([id, index]);
  }
  return JSON.stringify({ version, size: state.size, templates, entries, overrides: state.overrides });
}

export function restoreAnalysis(raw: string | null): SavedAnalysis | null {
  if (!raw || raw.length > 2000000) return null;
  try {
    const data = JSON.parse(raw);
    if (data.version !== version || !["sample", "large"].includes(data.size) || !Array.isArray(data.templates) || !Array.isArray(data.entries) || data.entries.length > 3000 || !data.overrides || typeof data.overrides !== "object") return null;
    for (const template of data.templates) {
      if (!template || !CATEGORIES.includes(template.category) || template.algorithmVersion !== ALGORITHM_VERSION || template.spotifyTrackId !== null || !Number.isFinite(template.houseConfidence) || template.houseConfidence < 0 || template.houseConfidence > 100 || !Number.isFinite(template.matchConfidence) || template.matchConfidence < 0 || template.matchConfidence > 100 || !Array.isArray(template.explanation) || !template.explanation.every((item: unknown) => typeof item === "string") || !Array.isArray(template.matchedSubgenres) || !template.matchedSubgenres.every((item: unknown) => typeof item === "string") || !Array.isArray(template.evidence) || !["matched", "missing", "ambiguous", "failed", "blocked"].includes(template.metadataStatus) || typeof template.metadataSource !== "string") return null;
    }
    const validId = (id: string) => data.size === "sample" ? /^fixture-(?:[0-9]|1[0-7])$/.test(id) : /^large-fixture-\d+$/.test(id) && Number(id.slice(14)) < 3000;
    const results: Record<string, ClassificationResult> = {};
    for (const [id, index] of data.entries) {
      if (typeof id !== "string" || !validId(id) || !Number.isInteger(index) || !data.templates[index]) return null;
      results[id] = { ...data.templates[index], trackId: id };
    }
    for (const [id, category] of Object.entries(data.overrides)) if (!validId(id) || !CATEGORIES.includes(category as Category)) return null;
    return { size: data.size, results, overrides: data.overrides };
  } catch { return null; }
}
