import "server-only";
import { EnrichmentService } from "./enrichment";
import { MusicBrainzHttp, MusicBrainzProvider, musicBrainzUserAgent } from "./musicbrainz";

// Survives Next.js development module reloads. This is a single local Node
// process, not a distributed rate limiter or a durable background job system.
const runtime = globalThis as typeof globalThis & { housifyMusicBrainz?: { userAgent: string; service: EnrichmentService } };
export function liveEnrichment() {
  const userAgent = musicBrainzUserAgent(process.env.MUSICBRAINZ_CONTACT);
  if (runtime.housifyMusicBrainz?.userAgent !== userAgent) {
    runtime.housifyMusicBrainz = { userAgent, service: new EnrichmentService(new MusicBrainzProvider(new MusicBrainzHttp(userAgent)), { timeoutMs: 65000, retries: 0, cacheMs: 24 * 60 * 60 * 1000, maxEntries: 10000 }) };
  }
  return runtime.housifyMusicBrainz.service;
}
