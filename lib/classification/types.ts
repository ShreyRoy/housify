export const CATEGORIES = ["DEFINITELY_HOUSE", "IFFY_HOUSE", "NOT_HOUSE"] as const;
export type Category = typeof CATEGORIES[number];
export type EvidenceLevel = "recording" | "release" | "artist";
export type GenreEvidence = { tag: string; level: EvidenceLevel; source: string };

export type ClassificationTrack = {
  id: string;
  provenance: "independent-fixture" | "spotify-playlist";
  spotifyTrackId?: string | null;
  skipReason?: string;
  title: string;
  artists: string[];
  durationMs?: number;
  isrc?: string;
  recordingId?: string;
};
export type IndependentTrack = ClassificationTrack & { provenance: "independent-fixture" };
export type RecordingCandidate = {
  id: string;
  title: string;
  artists: string[];
  aliases?: string[];
  durationMs?: number;
  isrcs?: string[];
  evidence: GenreEvidence[];
};
export type Match = { candidate: RecordingCandidate | null; confidence: number; method: "recording-id" | "isrc" | "title-artist" | "none"; explanation: string };
export type Metadata = {
  status: "matched" | "missing" | "ambiguous" | "failed" | "blocked";
  source: string;
  matchConfidence: number;
  evidence: GenreEvidence[];
  explanation: string;
  retryable?: boolean;
  retryAfter?: number;
};
export type ClassificationResult = {
  trackId: string;
  spotifyTrackId: string | null;
  category: Category;
  houseConfidence: number;
  matchedSubgenres: string[];
  explanation: string[];
  metadataSource: string;
  matchConfidence: number;
  humanReviewRecommended: boolean;
  selectedByDefault: boolean;
  metadataStatus: Metadata["status"];
  retryable: boolean;
  retryAfter?: number;
  evidence: GenreEvidence[];
  algorithmVersion: string;
};
export type MetadataProvider = {
  id: string;
  minimumIntervalMs: number;
  lookup(track: ClassificationTrack, signal: AbortSignal): Promise<Metadata>;
};
