export function normalizeTag(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ").replace(/[-_/]/g, " ").replace(/\s+/g, " ").trim();
}

export const HOUSE_SUBGENRES = [
  "house", "chicago house", "classic house", "deep house", "tech house", "progressive house",
  "afro house", "melodic house", "acid house", "bass house", "piano house", "french house",
  "disco house", "minimal house", "organic house", "soulful house", "vocal house", "funky house",
  "tribal house", "latin house", "jackin house", "gospel house", "garage house", "balearic house",
  "italo house", "hip house", "electro house", "future house", "tropical house", "outsider house",
  "lo fi house", "microhouse", "diva house", "hard house", "ghetto house", "kwaito house", "jazz house",
  "ambient house", "scouse house", "dream house", "brazilian bass", "slap house",
] as const;
const house = new Set<string>(HOUSE_SUBGENRES);
const aliases: Record<string, string> = {
  "chicago/classic house": "chicago house", "chicago classic house": "chicago house",
  "classic chicago house": "chicago house", "acidhouse": "acid house", "deephouse": "deep house",
  "afrohouse": "afro house", "techhouse": "tech house", "nu disco house": "disco house",
  "french touch": "french house", "filter house": "french house", "filtered house": "french house",
  "discohouse": "disco house", "minimal deep tech": "minimal house", "micro house": "microhouse",
  "lofi house": "lo fi house", "jackin' house": "jackin house", "jackin’ house": "jackin house",
  "jacking house": "jackin house", "melodic house and techno": "melodic house and techno",
};
const adjacent = new Set([
  "uk garage", "garage", "2 step", "two step", "speed garage", "bassline", "uk funky",
  "techno", "minimal techno", "detroit techno", "dub techno", "hard techno", "melodic techno",
  "trance", "progressive trance", "psytrance", "drum and bass", "drum n bass", "dnb", "jungle",
  "dubstep", "brostep", "dance pop", "dancepop", "edm", "electronica", "breakbeat", "breaks",
  "disco", "nu disco", "electro", "future bass", "melodic house and techno", "witch house",
  "ghettotech", "footwork", "juke", "dancehall", "electronic dance music", "amapiano",
]);
const other = new Set([
  "rock", "indie rock", "alternative rock", "hard rock", "punk", "punk rock", "metal", "heavy metal",
  "classical", "baroque", "opera", "country", "folk", "bluegrass", "hip hop", "rap", "trap",
  "jazz", "blues", "reggae", "r and b", "rnb", "soul", "pop", "ambient", "acoustic", "reggaeton",
]);

export function genreKind(tag: string): { kind: "house" | "adjacent" | "other" | "unknown"; canonical: string; specificity: number } {
  const normalized = normalizeTag(tag);
  const canonical = aliases[normalized] || normalized;
  if (house.has(canonical)) return { kind: "house", canonical, specificity: canonical === "house" ? .85 : 1 };
  if (adjacent.has(canonical)) return { kind: "adjacent", canonical, specificity: .2 };
  if (other.has(canonical)) return { kind: "other", canonical, specificity: 1 };
  return { kind: "unknown", canonical, specificity: 0 };
}
