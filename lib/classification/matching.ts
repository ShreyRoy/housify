import type { ClassificationTrack, Match, RecordingCandidate } from "./types.ts";

export function normalizeName(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
export function titleParts(value: string) {
  const version = value.match(/(?:[-–—]\s*|[([])([^()[\]]*\b(?:remix|mix|edit|dub|live|instrumental|version)\b[^()[\]]*)[)\]]?\s*$/i);
  const base = version ? value.slice(0, version.index).trim() : value;
  const [title] = base.split(/\s(?:feat\.?|ft\.?)\s|\s[([](?:feat\.?|ft\.?)\s/i);
  return { base: normalizeName(title), version: normalizeName(version?.[1] || "") };
}
function similarity(a: string, b: string) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const x = new Set(a.split(" ")), y = new Set(b.split(" "));
  const overlap = [...x].filter(token => y.has(token)).length;
  const tokens = 2 * overlap / (x.size + y.size);
  // Small spelling differences are allowed only in longer names. Short names
  // remain exact/token matched to avoid confusing unrelated artists.
  if (Math.min(a.length, b.length) < 6 || Math.max(a.length, b.length) > 300) return tokens;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return Math.max(tokens, 1 - previous[b.length] / Math.max(a.length, b.length));
}
function normalizeIsrc(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }

export function matchRecording(track: ClassificationTrack, candidates: RecordingCandidate[]): Match {
  const input = titleParts(track.title);
  const scores = candidates.map(candidate => {
    const target = titleParts(candidate.title);
    const exactId = !!track.recordingId && track.recordingId === candidate.id;
    const exactIsrc = !!track.isrc && /^\w{12}$/.test(normalizeIsrc(track.isrc)) && candidate.isrcs?.some(isrc => normalizeIsrc(isrc) === normalizeIsrc(track.isrc!));
    const artist = Math.max(0, ...[candidate.artists[0], ...(candidate.aliases || [])].filter(Boolean).map(other => similarity(normalizeName(track.artists[0] || ""), normalizeName(other))));
    const title = similarity(input.base, target.base);
    const versionMismatch = input.version !== target.version;
    const delta = track.durationMs !== undefined && candidate.durationMs !== undefined ? Math.abs(track.durationMs - candidate.durationMs) : null;
    // Identifiers still need sane artist/title/version corroboration: ISRCs may be erroneous.
    const valid = artist >= .8 && title >= .85 && !versionMismatch && (delta === null || delta <= 12000);
    const score = !valid ? Math.min(60, Math.round((title + artist) * 25)) : exactId ? 100 : exactIsrc ? 99 : Math.round(60 * title + 35 * artist + (delta !== null && delta <= 3000 ? 2 : 0));
    return { candidate, score, method: exactId ? "recording-id" : exactIsrc ? "isrc" : "title-artist" } as const;
  }).sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || best.score < 90) return { candidate: null, confidence: best?.score || 0, method: "none", explanation: "No candidate passed title, artist, version and duration checks." };
  // Different releases of the same recording should share one recording ID.
  const runner = scores.find(candidate => candidate.candidate.id !== best.candidate.id && candidate.method === best.method);
  if (runner && runner.score >= best.score - 5) return { candidate: null, confidence: best.score, method: "none", explanation: "Multiple recordings are equally plausible; tags were not trusted." };
  return { candidate: best.candidate, confidence: best.score, method: best.method, explanation: `Verified ${best.method} match with title, artist and version corroboration (${best.score}/100).` };
}
