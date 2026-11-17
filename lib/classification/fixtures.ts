import type { GenreEvidence, IndependentTrack, RecordingCandidate } from "./types.ts";

// Authored for this project. All artists, songs, IDs, ISRC-like values and tags
// are fictional; nothing is copied from Spotify or the MusicBrainz database.
const source = "Housify independent fictional fixtures";
const tags = (names: string[], level: GenreEvidence["level"] = "recording") => names.map(tag => ({ tag, level, source }));
const definitions = [
  { title: "Basement Light", artist: "Paper Circuit", tags: ["Chicago house", "classic house"] },
  { title: "Blue Corridor", artist: "Glass Orchard", tags: ["deep house", "soulful house"] },
  { title: "Copper Steps", artist: "Juniper Pulse", tags: ["Afro house", "organic house"] },
  { title: "Night Geometry - Iris Remix", artist: "Quiet Phase", tags: ["melodic house", "progressive house"] },
  { title: "Acid Postcard", artist: "Velvet Switch", tags: ["acid house", "tech house"] },
  { title: "Mirrored Floor", artist: "Studio Fern", tags: ["French house", "disco house", "piano house"] },
  { title: "Low Orbit", artist: "Circuit Moss", tags: ["bass house", "minimal house"] },
  { title: "Another Platform", artist: "Dusk Archive", tags: ["UK garage", "2-step"] },
  { title: "Red Signal", artist: "Vapor Field", tags: ["techno", "trance"] },
  { title: "Static Bloom", artist: "Marble Current", tags: ["drum & bass", "dubstep"] },
  { title: "Weekend Letters", artist: "Harbor Echo", tags: ["dance-pop"] },
  { title: "Two Directions", artist: "Linen Signal", tags: ["deep house", "rock"] },
  { title: "Woodland Suite", artist: "The Willow Quartet", tags: ["classical"] },
  { title: "Northbound", artist: "Canvas Avenue", tags: ["indie rock"] },
  { title: "Unmarked Tape", artist: "Unknown Season", tags: [] },
  { title: "In the Margins", artist: "Paper Circuit", tags: ["house"], level: "artist" as const },
  { title: "Various Rooms", artist: "Soft Transit", tags: ["deep house"], level: "release" as const },
  { title: "Delayed Arrival", artist: "Cloud Assembly", tags: ["vocal house"] },
];

export const FIXTURE_TRACKS: IndependentTrack[] = definitions.map((item, index) => ({ id: `fixture-${index}`, provenance: "independent-fixture", title: item.title, artists: [item.artist], durationMs: 240000 + index * 1000, isrc: `ZZFIX260${String(index).padStart(4, "0")}` }));
export const FIXTURE_CATALOG: RecordingCandidate[] = definitions.map((item, index) => ({ id: `independent-recording-${index}`, title: item.title, artists: [item.artist], durationMs: FIXTURE_TRACKS[index].durationMs, isrcs: [FIXTURE_TRACKS[index].isrc!], evidence: tags(item.tags, item.level || "recording") }));
export const TRANSIENT_FAILURE_ID = FIXTURE_TRACKS[17].id;
export const FIXTURE_VERSION = "independent-fixtures-v1";

export function fixturePlaylist(size: "sample" | "large") {
  if (size === "sample") return FIXTURE_TRACKS;
  // Thousands of rows, eighteen unique recording lookups. Order and duplicates stay intact.
  return Array.from({ length: 3000 }, (_, index) => ({ ...FIXTURE_TRACKS[index % FIXTURE_TRACKS.length], id: `large-fixture-${index}` }));
}
