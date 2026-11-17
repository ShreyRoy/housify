import { recordingKey } from "./recording-key.ts";
import type { ClassificationTrack, Metadata, MetadataProvider } from "./types.ts";

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason || new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class EnrichmentService {
  private cache = new Map<string, { value: Metadata; expires: number }>();
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;
  constructor(private provider: MetadataProvider, private options = { timeoutMs: 8000, retries: 1, cacheMs: 60 * 60 * 1000, maxEntries: 10000 }) {}

  private key(track: ClassificationTrack) {
    // Preserve the complete remix/version title; never merge solely on base title or artist.
    return `${this.provider.id}:${recordingKey(track)}`;
  }

  lookup(track: ClassificationTrack, signal: AbortSignal, retry = false): Promise<Metadata> {
    const key = this.key(track);
    // Serialize to make provider rate limits apply across parallel callers too.
    const task = this.tail.catch(() => {}).then(async () => {
      signal.throwIfAborted();
      const cached = this.cache.get(key);
      if (cached && cached.expires > Date.now() && (!retry || !cached.value.retryable)) return cached.value;
      let value: Metadata | undefined;
      for (let attempt = 0; attempt <= this.options.retries; attempt++) {
        await delay(Math.max(0, this.lastStart + this.provider.minimumIntervalMs - Date.now()), signal);
        while (Date.now() < this.lastStart + this.provider.minimumIntervalMs) await delay(this.lastStart + this.provider.minimumIntervalMs - Date.now(), signal);
        this.lastStart = Date.now();
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => controller.abort(new DOMException("Metadata request timed out", "TimeoutError")), this.options.timeoutMs);
        try {
          const timeout = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
          value = await Promise.race([this.provider.lookup(track, controller.signal), timeout]);
          break;
        } catch {
          signal.throwIfAborted();
          if (attempt === this.options.retries) value = { status: "failed", source: this.provider.id, matchConfidence: 0, evidence: [], retryable: true, explanation: "Metadata lookup failed after bounded retries. This does not mean the track is not house." };
          else await delay(200 * 2 ** attempt, signal);
        } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
      }
      signal.throwIfAborted();
      const result = value!;
      this.cache.delete(key);
      if (this.cache.size >= this.options.maxEntries) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { value: result, expires: Date.now() + (result.status === "failed" ? 15000 : this.options.cacheMs) });
      return result;
    });
    this.tail = task;
    return task;
  }
}
