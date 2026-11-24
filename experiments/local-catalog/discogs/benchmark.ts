import { BENCHMARK, type BenchmarkCase, type Stratum } from "../benchmark.ts";
import { REFERENCES } from "./references.ts";

export type DiscogsCase = BenchmarkCase & {
  split: "tuning" | "held-out";
  durationMs?: number;
  identityReference?: string;
};
// Candidate selection is independent of the Discogs dump. The original six
// recording-specific gold labels remain eligible; new candidates do not gain
// gold labels from an artist's reputation or from the catalog being evaluated.
// 100 candidates are provided, but unadjudicated labels are explicitly null.
const original = BENCHMARK.map((item, index) => ({ ...item, split: index % 4 === 0 ? "tuning" as const : "held-out" as const }));
const additional: [Stratum, string, string, string, number?][] = [
  ["mainstream", "Daft Punk", "Around The World", "https://en.wikipedia.org/wiki/Around_the_World_(Daft_Punk_song)"],
  ["mainstream", "Daft Punk", "Digital Love", "https://en.wikipedia.org/wiki/Digital_Love"],
  ["mainstream", "Daft Punk", "Da Funk", "https://en.wikipedia.org/wiki/Da_Funk"],
  ["mainstream", "Modjo", "Lady (Hear Me Tonight)", "https://en.wikipedia.org/wiki/Lady_(Hear_Me_Tonight)"],
  ["mainstream", "Robin S.", "Show Me Love", "https://en.wikipedia.org/wiki/Show_Me_Love_(Robin_S._song)"],
  ["mainstream", "Crystal Waters", "Gypsy Woman (She's Homeless)", "https://en.wikipedia.org/wiki/Gypsy_Woman_(Crystal_Waters_song)"],
  ["mainstream", "CeCe Peniston", "Finally", "https://en.wikipedia.org/wiki/Finally_(CeCe_Peniston_song)"],
  ["mainstream", "Mr. Fingers", "Can You Feel It", "https://en.wikipedia.org/wiki/Can_You_Feel_It_(Larry_Heard_song)"],
  ["mainstream", "Frankie Knuckles", "Your Love", "https://en.wikipedia.org/wiki/Your_Love_(Jamie_Principle_song)"],
  ["mainstream", "Armand Van Helden", "You Don't Know Me", "https://en.wikipedia.org/wiki/You_Don%27t_Know_Me_(Armand_Van_Helden_song)"],
  ["mainstream", "Spiller", "Groovejet (If This Ain't Love)", "https://en.wikipedia.org/wiki/Groovejet_(If_This_Ain%27t_Love)"],
  ["mainstream", "Roger Sanchez", "Another Chance", "https://en.wikipedia.org/wiki/Another_Chance"],
  ["mainstream", "Moloko", "Sing It Back (Boris Musical Mix)", "https://en.wikipedia.org/wiki/Sing_It_Back"],
  ["mainstream", "Basement Jaxx", "Red Alert", "https://en.wikipedia.org/wiki/Red_Alert_(song)"],
  ["mainstream", "The Shapeshifters", "Lola's Theme", "https://en.wikipedia.org/wiki/Lola%27s_Theme"],
  ["mainstream", "St Germain", "Rose Rouge", "https://en.wikipedia.org/wiki/Rose_Rouge"],
  ["mainstream", "Disclosure", "White Noise", "https://en.wikipedia.org/wiki/White_Noise_(Disclosure_song)"],
  ["underground", "KETTAMA", "Raw Cuts", "https://kettama.bandcamp.com/album/bucklyn-bridge"],
  ["underground", "KETTAMA", "B O D Y", "https://kettama.bandcamp.com/album/bucklyn-bridge"],
  ["underground", "KETTAMA", "Fly Away XTC", "https://kettama.bandcamp.com/"],
  ["underground", "KETTAMA", "Fallen Angel", "https://kettama.bandcamp.com/"],
  ["underground", "KETTAMA", "Yosemite", "https://steelcitydancediscs.bandcamp.com/album/archangel", 362000],
  ["underground", "Prospa", "Prayer", "https://prospamusic.bandcamp.com/"],
  ["underground", "Prospa", "Ecstasy (Over & Over)", "https://prospamusic.bandcamp.com/"],
  ["underground", "Prospa", "Want Need Love", "https://prospamusic.bandcamp.com/"],
  ["underground", "Prospa", "If You Want My Loving", "https://prospamusic.bandcamp.com/"],
  ["underground", "Josh Baker", "Bass Up", "https://www.joshbakermusic.com/"],
  ["underground", "Josh Baker", "Something To Me", "https://www.joshbakermusic.com/"],
  ["underground", "Franky Rizardo", "Same Man", "https://frankyrizardo.com/"],
  ["underground", "Franky Rizardo", "Love Me Right", "https://frankyrizardo.com/"],
  ["underground", "DJ Seinfeld", "U", "https://djseinfeld.bandcamp.com/album/time-spent-away-from-u"],
  ["underground", "Ross From Friends", "Talk To Me You'll Understand", "https://rossfromfriends.bandcamp.com/"],
  ["underground", "Mall Grab", "Liverpool Street In The Rain", "https://mallgrab.bandcamp.com/"],
  ["underground", "Harrison BDP", "Decompression", "https://harrisonbdp.bandcamp.com/"],
  // 2026 titles/durations are independent reference observations, not catalog labels.
  ["recent", "Prospa", "Intro", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 52000],
  ["recent", "Prospa", "Party People", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 232000],
  ["recent", "Prospa", "The Situation", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 275000],
  ["recent", "Prospa", "Free Your Mind", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 201000],
  ["recent", "Prospa", "Break Free", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 246000],
  ["recent", "Prospa", "Body Heat", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 206000],
  ["recent", "Prospa", "Masterplan", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 226000],
  ["recent", "Prospa", "Let the Music", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 232000],
  ["recent", "Josh Baker", "Down To The Bone", "https://www.skiddle.com/news/all/Josh-Baker-links-with-Eliza-Rose-on-summer-ready-house-cut-Down-To-The-Bone/61523/"],
  ["recent", "Prospa", "Baby", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 193000],
  ["recent", "Prospa", "Dreams", "https://en.wikipedia.org/wiki/Free_Your_Mind_(Prospa_album)", 236000],
  ["recent", "Josh Baker", "Breaking Point", "https://dmy.co/new-music/josh-baker-drops-four-track-club-ep-breaking-point"],
  ["recent", "Josh Baker", "Over You", "https://dmy.co/new-music/josh-baker-drops-four-track-club-ep-breaking-point"],
  ["recent", "Josh Baker", "Your Star", "https://dmy.co/new-music/josh-baker-drops-four-track-club-ep-breaking-point"],
  ["recent", "Josh Baker", "House With Acres", "https://dmy.co/new-music/josh-baker-drops-four-track-club-ep-breaking-point"],
  ["recent", "Franky Rizardo", "Shinjuku (Extended Mix)", "https://app.qisum.nl/artist/franky-rizardo/ep/shinjuku-1", 353000],
  ["recent", "KETTAMA", "Comes and Goes (Dom Dolla Remix)", "https://en.wikipedia.org/wiki/Comes_and_Goes_(song)"],
  ["adjacent", "Underworld", "Born Slippy .NUXX", "https://en.wikipedia.org/wiki/Born_Slippy_Nuxx"],
  ["adjacent", "The Prodigy", "Firestarter", "https://en.wikipedia.org/wiki/Firestarter_(The_Prodigy_song)"],
  ["adjacent", "The Prodigy", "Breathe", "https://en.wikipedia.org/wiki/Breathe_(The_Prodigy_song)"],
  ["adjacent", "Aphex Twin", "Windowlicker", "https://en.wikipedia.org/wiki/Windowlicker"],
  ["adjacent", "Jeff Mills", "The Bells", "https://en.wikipedia.org/wiki/Jeff_Mills"],
  ["adjacent", "Darude", "Sandstorm", "https://en.wikipedia.org/wiki/Sandstorm_(instrumental)"],
  ["adjacent", "Energy 52", "Café Del Mar (Three 'N One Remix)", "https://en.wikipedia.org/wiki/Caf%C3%A9_del_Mar_(song)"],
  ["adjacent", "Robert Miles", "Children (Dream Version)", "https://en.wikipedia.org/wiki/Children_(Robert_Miles_song)"],
  ["adjacent", "Goldie", "Inner City Life", "https://en.wikipedia.org/wiki/Inner_City_Life"],
  ["adjacent", "Shy FX", "Original Nuttah", "https://en.wikipedia.org/wiki/Original_Nuttah"],
  ["adjacent", "Burial", "Archangel", "https://en.wikipedia.org/wiki/Archangel_(song)"],
  ["adjacent", "Skream", "Midnight Request Line", "https://en.wikipedia.org/wiki/Midnight_Request_Line"],
  ["adjacent", "Skrillex", "Scary Monsters And Nice Sprites", "https://en.wikipedia.org/wiki/Scary_Monsters_and_Nice_Sprites_(song)"],
  ["adjacent", "Boards Of Canada", "Roygbiv", "https://en.wikipedia.org/wiki/Music_Has_the_Right_to_Children"],
  ["unrelated", "The Beatles", "Yesterday", "https://en.wikipedia.org/wiki/Yesterday_(Beatles_song)"],
  ["unrelated", "The Beatles", "Hey Jude", "https://en.wikipedia.org/wiki/Hey_Jude"],
  ["unrelated", "Queen", "Bohemian Rhapsody", "https://en.wikipedia.org/wiki/Bohemian_Rhapsody"],
  ["unrelated", "AC/DC", "Back In Black", "https://en.wikipedia.org/wiki/Back_in_Black_(song)"],
  ["unrelated", "Metallica", "Enter Sandman", "https://en.wikipedia.org/wiki/Enter_Sandman"],
  ["unrelated", "Radiohead", "Creep", "https://en.wikipedia.org/wiki/Creep_(Radiohead_song)"],
  ["unrelated", "Johnny Cash", "Ring Of Fire", "https://en.wikipedia.org/wiki/Ring_of_Fire_(song)"],
  ["unrelated", "Dolly Parton", "9 To 5", "https://en.wikipedia.org/wiki/9_to_5_(Dolly_Parton_song)"],
  ["unrelated", "John Coltrane", "Giant Steps", "https://en.wikipedia.org/wiki/Giant_Steps_(composition)"],
  ["unrelated", "Dave Brubeck", "Take Five", "https://en.wikipedia.org/wiki/Take_Five"],
  ["unrelated", "Louis Armstrong", "What A Wonderful World", "https://en.wikipedia.org/wiki/What_a_Wonderful_World"],
  ["unrelated", "Eminem", "Lose Yourself", "https://en.wikipedia.org/wiki/Lose_Yourself"],
  ["unrelated", "Kendrick Lamar", "HUMBLE.", "https://en.wikipedia.org/wiki/Humble_(song)"],
  ["unrelated", "Adele", "Someone Like You", "https://en.wikipedia.org/wiki/Someone_Like_You_(Adele_song)"],
  ["unrelated", "Taylor Swift", "Shake It Off", "https://en.wikipedia.org/wiki/Shake_It_Off"],
  ["unrelated", "Bob Marley & The Wailers", "Three Little Birds", "https://en.wikipedia.org/wiki/Three_Little_Birds"],
  ["unrelated", "Nina Simone", "Feeling Good", "https://en.wikipedia.org/wiki/Feeling_Good"],
];

export const DISCOGS_BENCHMARK: DiscogsCase[] = [
  ...original,
  ...additional.map(([stratum, artist, title, identityUrl, durationMs], index): DiscogsCase => ({
    id: `discogs-${index + 1}`, stratum, artist, title, identityUrl, durationMs,
    identityReference: durationMs ? identityUrl : undefined,
    released: identityUrl.includes("Free_Your_Mind_") ? "2026-06-05" : identityUrl.includes("breaking-point") ? "2026-08-28" : title === "Shinjuku (Extended Mix)" ? "2026-03-20" : title.includes("Dom Dolla Remix") ? "2026-07-17" : undefined,
    split: index % 4 === 0 ? "tuning" : "held-out", gold: null,
    note: "Independent candidate; track identity/genre adjudication pending. Excluded from accuracy denominators until reviewed.",
  })),
].map((item: DiscogsCase) => {
  const reference = REFERENCES[`${item.artist}|${item.title}`];
  if (!reference) return item;
  const url = reference.url || item.identityUrl;
  return { ...item, durationMs: reference.durationMs ?? item.durationMs, identityReference: reference.durationMs ? reference.durationUrl || item.identityReference || url : item.identityReference,
    released: item.title === "Down To The Bone" ? "2026-03-31" : item.released,
    gold: { family:reference.family, genre:reference.genre, url, scope:reference.scope||"recording" as const, note:reference.note||"Independent track-specific reference reviewed 2026-11-24; applies to the named version (original studio where unspecified). Exact identity is not independently audited against every pressing." },
  };
});
