import { matchRecording } from "./matching.ts";
import type { ClassificationTrack, Metadata, MetadataProvider, RecordingCandidate } from "./types.ts";

export class FixtureProvider implements MetadataProvider {
  id = "independent-fixtures-v1";
  minimumIntervalMs = 0;
  private attempts = new Map<string, number>();
  constructor(private catalog: RecordingCandidate[], private transientFailures: string[] = []) {}
  async lookup(track: ClassificationTrack, signal: AbortSignal): Promise<Metadata> {
    signal.throwIfAborted();
    if (track.provenance !== "independent-fixture") throw new Error("Only independent fixtures are accepted");
    const attempts = this.attempts.get(track.id) || 0;
    this.attempts.set(track.id, attempts + 1);
    if (this.transientFailures.includes(track.id) && attempts < 2) throw new Error("Simulated fixture provider timeout");
    const match = matchRecording(track, this.catalog);
    return { status: match.candidate ? "matched" : match.confidence >= 90 ? "ambiguous" : "missing", source: "Independent fictional fixture catalog", matchConfidence: match.confidence, evidence: match.candidate?.evidence || [], explanation: match.explanation };
  }
}

export { MusicBrainzProvider } from "./musicbrainz.ts";
