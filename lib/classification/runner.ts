import { classify } from "./classifier.ts";
import { delay, EnrichmentService } from "./enrichment.ts";
import type { ClassificationResult, ClassificationTrack } from "./types.ts";

export async function analyzeTracks(tracks: ClassificationTrack[], service: EnrichmentService, signal: AbortSignal, onResult: (result: ClassificationResult, index: number) => void, retry = false) {
  for (let index = 0; index < tracks.length; index++) {
    signal.throwIfAborted();
    const metadata = await service.lookup(tracks[index], signal, retry);
    signal.throwIfAborted();
    onResult(classify(tracks[index], metadata), index);
    // Yield to painting and cancellation even for fully cached playlists.
    if (index % 20 === 0) await delay(0, signal);
  }
}
