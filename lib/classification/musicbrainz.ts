import { delay } from "./enrichment.ts";
import { matchRecording, titleParts } from "./matching.ts";
import type { ClassificationTrack, GenreEvidence, Metadata, MetadataProvider, RecordingCandidate } from "./types.ts";

type MbTag = { name?: string; count?: number };
type MbRecording = { id?: string; title?: string; length?: number; disambiguation?: string; isrcs?: string[]; "artist-credit"?: { name?: string; artist?: { name?: string } }[]; genres?: MbTag[]; tags?: MbTag[]; releases?: { id?: string }[] };
export class MusicBrainzError extends Error {
  constructor(message: string, public retryAfter?: number) { super(message); }
}
export function musicBrainzUserAgent(contact: string | undefined) {
  if (!contact || /[\r\n()]/.test(contact)) throw new Error("Set MUSICBRAINZ_CONTACT to a public maintainer URL or email in .env.local, then restart Housify.");
  const url = /^https:\/\//.test(contact);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  if (!url && !email) throw new Error("MUSICBRAINZ_CONTACT must be a public HTTPS URL or email.");
  if (url) { const parsed = new URL(contact); if (parsed.username || parsed.password || ["localhost", "127.0.0.1"].includes(parsed.hostname)) throw new Error("Use a public MusicBrainz contact URL."); }
  return `Housify/0.1.0 (${contact})`;
}

// One instance is shared by all live routes in the local server. Limit each
// HTTP attempt, not merely logical recordings (which require several requests).
export class MusicBrainzHttp {
  private tail: Promise<unknown> = Promise.resolve();
  private nextStart = 0;
  private cache = new Map<string, { expires: number; value: unknown }>();
  constructor(private userAgent: string, private request: typeof fetch = fetch, private settings = { intervalMs: 1100, timeoutMs: 8000, retries: 1, cacheMs: 24 * 60 * 60 * 1000, maxEntries: 10000 }) {}

  get<T>(resource: string, params: Record<string, string>, signal: AbortSignal): Promise<T | null> {
    if (!/^(recording|isrc|release)\/(?:[a-zA-Z0-9-]*)$/.test(resource)) throw new Error("Invalid MusicBrainz resource");
    const url = new URL(`https://musicbrainz.org/ws/2/${resource}`);
    url.search = new URLSearchParams({ ...params, fmt: "json" }).toString();
    const key = url.href;
    const task = this.tail.catch(() => {}).then(async () => {
      signal.throwIfAborted();
      const cached = this.cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.value as T;
      for (let attempt = 0; attempt <= this.settings.retries; attempt++) {
        if (this.nextStart - Date.now() > 10000) throw new MusicBrainzError("MusicBrainz requested a cooldown. Resume after the countdown.", Math.ceil((this.nextStart - Date.now()) / 1000));
        while (Date.now() < this.nextStart) await delay(Math.min(1000, this.nextStart - Date.now()), signal);
        signal.throwIfAborted();
        this.nextStart = Date.now() + this.settings.intervalMs;
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(new DOMException("MusicBrainz request timed out", "TimeoutError")), this.settings.timeoutMs);
        const combined = AbortSignal.any([signal, timeout.signal]);
        let onAbort: () => void = () => {};
        const aborted = new Promise<never>((_, reject) => { onAbort = () => reject(combined.reason); combined.addEventListener("abort", onAbort, { once: true }); });
        try {
          combined.throwIfAborted();
          const response = await Promise.race([this.request(url, { headers: { "User-Agent": this.userAgent, Accept: "application/json" }, signal: combined, cache: "no-store", redirect: "error" }), aborted]);
          if (response.status === 404) return null;
          if (!response.ok) {
            if ([429, 503].includes(response.status)) {
              const raw = response.headers.get("Retry-After");
              const parsed = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : 2 ** (attempt + 1);
              const seconds = Number.isFinite(parsed) ? Math.max(1, parsed) : 5;
              this.nextStart = Math.max(this.nextStart, Date.now() + seconds * 1000);
              if (seconds > 10 || attempt === this.settings.retries) throw new MusicBrainzError("MusicBrainz is rate-limiting requests. Analysis is paused; retry after the cooldown.", seconds);
            } else if (response.status < 500) throw new MusicBrainzError(`MusicBrainz rejected the metadata request (${response.status}). Check the contact setting and service access.`);
            else throw new Error("MusicBrainz service error");
          } else {
            const value: unknown = await Promise.race([response.json(), aborted]);
            signal.throwIfAborted();
            if (this.cache.size >= this.settings.maxEntries) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(key, { value, expires: Date.now() + this.settings.cacheMs });
            return value as T;
          }
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof MusicBrainzError) throw error;
          if (attempt === this.settings.retries) throw new MusicBrainzError("MusicBrainz could not be reached or timed out after retrying. This is missing evidence, not evidence against house.");
          this.nextStart = Math.max(this.nextStart, Date.now() + 1000 * 2 ** attempt);
        } finally { clearTimeout(timer); combined.removeEventListener("abort", onAbort); }
      }
      throw new MusicBrainzError("MusicBrainz lookup did not complete.");
    });
    this.tail = task;
    return task;
  }
}

function evidence(entity: { genres?: MbTag[]; tags?: MbTag[] }, level: GenreEvidence["level"], source: string): GenreEvidence[] {
  const names = new Set([...(entity.genres || []), ...(entity.tags || [])].filter(tag => typeof tag.name === "string" && (tag.count === undefined || tag.count > 0)).map(tag => tag.name!.trim()).filter(Boolean));
  return [...names].map(tag => ({ tag, level, source }));
}
function candidate(recording: MbRecording): RecordingCandidate | null {
  if (!recording.id || !recording.title || !Array.isArray(recording["artist-credit"])) return null;
  const artists = recording["artist-credit"].map(credit => credit.artist?.name || credit.name || "").filter(Boolean);
  const aliases = recording["artist-credit"].flatMap(credit => [credit.name, credit.artist?.name].filter((name): name is string => !!name));
  const version = recording.disambiguation && /\b(remix|mix|edit|dub|live|instrumental|version)\b/i.test(recording.disambiguation) && !titleParts(recording.title).version ? ` (${recording.disambiguation})` : "";
  return { id: recording.id, title: recording.title + version, artists, aliases: aliases.slice(0, 2), durationMs: recording.length, isrcs: recording.isrcs, evidence: evidence(recording, "recording", `https://musicbrainz.org/recording/${recording.id}`) };
}
function quoted(value: string) { return `"${value.replace(/[\\"]/g, " ").slice(0, 300)}"`; }

export class MusicBrainzProvider implements MetadataProvider {
  id = "musicbrainz-live-v1";
  minimumIntervalMs = 0; // MusicBrainzHttp owns the global per-HTTP request limiter.
  constructor(private http: MusicBrainzHttp) {}

  async lookup(track: ClassificationTrack, signal: AbortSignal): Promise<Metadata> {
    if (track.provenance !== "spotify-playlist") throw new Error("Fixture tracks must use FixtureProvider");
    const base: Metadata = { status: "missing", source: "MusicBrainz", matchConfidence: 0, evidence: [], explanation: "MusicBrainz has no verified recording match. Kept for human review." };
    if (track.skipReason) return { ...base, source: "Spotify item metadata (lookup skipped)", explanation: track.skipReason };
    try {
      let recordings: MbRecording[] = [];
      let match = matchRecording(track, []);
      const isrc = track.isrc?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      if (isrc && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) {
        const response = await this.http.get<{ recordings?: MbRecording[] }>(`isrc/${isrc}`, { inc: "artist-credits+isrcs" }, signal);
        recordings = (response?.recordings || []).map(recording => ({ ...recording, isrcs: [...(recording.isrcs || []), isrc] }));
        match = matchRecording(track, recordings.map(candidate).filter((item): item is RecordingCandidate => !!item));
      }
      if (!match.candidate) {
        const search = await this.http.get<{ recordings?: MbRecording[] }>("recording/", { query: `recording:${quoted(titleParts(track.title).base)} AND artist:${quoted(track.artists[0] || "")}`, limit: "10" }, signal);
        recordings = search?.recordings || [];
        match = matchRecording(track, recordings.map(candidate).filter((item): item is RecordingCandidate => !!item));
      }
      if (!match.candidate) return { ...base, status: match.confidence >= 90 ? "ambiguous" : "missing", matchConfidence: match.confidence, explanation: match.explanation };
      const id = match.candidate.id;
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Malformed MusicBrainz recording identifier");
      const details = await this.http.get<MbRecording>(`recording/${id}`, { inc: "genres+tags+artist-credits+isrcs+releases" }, signal);
      if (!details || details.id !== id) return { ...base, explanation: "The matched MusicBrainz recording is no longer available." };
      // Verify the detailed entity as well; never borrow tags from another version.
      const detailed = candidate(details);
      if (!detailed) throw new Error("Incomplete MusicBrainz recording response");
      const verified = matchRecording(track, [detailed]);
      if (!verified.candidate) return { ...base, explanation: verified.explanation };
      const tags = [...detailed.evidence];
      const warnings: string[] = [];
      // At most two alternate releases of this matched recording. Release tags
      // remain weak context and can never independently create a definite result.
      for (const releaseId of [...new Set((details.releases || []).map(release => release.id).filter((id): id is string => !!id && /^[a-f0-9-]{36}$/i.test(id)))].slice(0, 2)) {
        try {
          const release = await this.http.get<{ id?: string; genres?: MbTag[]; tags?: MbTag[] }>(`release/${releaseId}`, { inc: "genres+tags" }, signal);
          if (release?.id === releaseId) tags.push(...evidence(release, "release", `https://musicbrainz.org/release/${releaseId}`));
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof MusicBrainzError && error.retryAfter) throw error;
          warnings.push("Some release-level context could not be retrieved; recording evidence is still shown.");
        }
      }
      return { status: "matched", source: "MusicBrainz community genres/tags (CC BY-NC-SA 3.0)", matchConfidence: Math.max(match.confidence, verified.confidence), evidence: tags, retryable: warnings.length > 0, explanation: `${match.explanation} Detailed recording identity also verified.${warnings.length ? ` ${warnings.join(" ")}` : ""}` };
    } catch (error) {
      signal.throwIfAborted();
      return { ...base, status: "failed", retryable: true, retryAfter: error instanceof MusicBrainzError ? error.retryAfter : undefined, explanation: error instanceof MusicBrainzError ? error.message : "MusicBrainz returned incomplete or invalid data. The lookup can be retried; no genre was assumed." };
    }
  }
}
