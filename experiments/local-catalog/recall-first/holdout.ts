import type { Query } from "./types.ts";
export type Case=Query&{id:string;group:string;gold:"house"|"non_house"|null;reference:string;note?:string};
// Frozen before inspecting real compact-classifier results. No entries are used
// by the builder, taxonomy lookup or override store. Null means unadjudicated or
// genuinely ambiguous, not a negative label. Genre references concern the named
// version; originals never supply gold for an otherwise unreviewed remix.
const raw:[string,string,string,Case["gold"],string,number?][]=[
  ["mainstream","Daft Punk","Burnin'","house","https://en.wikipedia.org/wiki/Burnin%27_(Daft_Punk_song)",413000],
  ["mainstream","Daft Punk","Revolution 909","house","https://en.wikipedia.org/wiki/Revolution_909",324000],
  ["mainstream","Disclosure","Latch","house","https://en.wikipedia.org/wiki/Latch_(song)",256000],
  ["mainstream","Disclosure","When A Fire Starts To Burn",null,"https://en.wikipedia.org/wiki/When_a_Fire_Starts_to_Burn"],
  ["underground","KETTAMA","Higher (Steel City Power House)",null,"https://steelcitydancediscs.bandcamp.com/"],
  ["underground","Prospa","This Rhythm","house","https://moonlvnding.com/music/prospa-produces-another-winner-with-this-rhythm/"],
  ["underground","DJ Seinfeld","These Things Will Come To Be","house","https://stereogum.com/2154878/dj-seinfeld-these-things-will-come-to-be/music"],
  ["underground","Ross From Friends","The Daisy",null,"https://rossfromfriends.bandcamp.com/"],
  ["recent","KETTAMA","Think Of You","house","https://www.guettapen.com/2026/10/10/think-of-you-de-kettama-prospa-lun-des-titres-de-lannee/"],
  ["recent","Josh Baker","Souvenir",null,"https://theidlibrary.com/artist?n=Josh+Baker"],
  ["recent","Jonas Blue","Edge Of Desire (Franky Rizardo Extended Remix)","house","https://www.traxsource.com/artist/12191/franky-rizardo/top",300000],
  ["recent","Josh Baker","Feel This Way",null,"https://theidlibrary.com/artist?n=Josh+Baker"],
  ["niche","DJ BORING","Winona","house","https://www.musicradar.com/news/dj-boring-interview"],
  ["niche","Palms Trax","Equation","house","https://pitchfork.com/reviews/tracks/16095-palms-trax-equation/"],
  ["niche","DJ Poolboi","Like We Were The Last Two People On Earth",null,"https://djpoolboi.bandcamp.com/"],
  ["niche","Harrison BDP","It's Foggy Outside",null,"https://harrisonbdp.bandcamp.com/"],
  ["rapper","Drake","Massive","house","https://en.wikipedia.org/wiki/Massive_(song)",336000],
  ["rapper","Drake","Falling Back","house","https://en.wikipedia.org/wiki/Falling_Back_(song)",265000],
  ["rapper","Skepta","Can't Play Myself (A Tribute To Amy)","house","https://www.thefader.com/2023/10/13/skepta-samples-amy-winehouse-on-cant-play-myself-tribute-to-amy"],
  ["rapper","Skepta","Shutdown","non_house","https://en.wikipedia.org/wiki/Shutdown_(Skepta_song)",188000],
  ["mixed","Fred again..","Delilah (Pull Me Out Of This)","house","https://themusic.com.au/news/fred-again-new-single-delilah-pull-me-out-this/cpduZGdmaWg/18-10-22"],
  ["mixed","Fred again..","Jungle",null,"https://en.wikipedia.org/wiki/Jungle_(Fred_Again_song)"],
  ["mixed","Prospa","Control The Party",null,"https://prospamusic.bandcamp.com/"],
  ["mixed","KETTAMA","Temperature Rising",null,"https://kettama.bandcamp.com/"],
  ["version","Prospa","WANT NEED LOVE (Dimension Remix)",null,"https://prospamusic.bandcamp.com/"],
  ["version","Prospa","Prayer (DJ Seinfeld Remix)",null,"https://stressrecords.bandcamp.com/"],
  ["version","Fred again..","Jungle (Rico Nasty Remix)",null,"https://en.wikipedia.org/wiki/Jungle_(Fred_Again_song)"],
  ["version","Disclosure","Latch (DJ Premier Remix)",null,"https://en.wikipedia.org/wiki/Latch_(song)"],
  ["emerging","BUNT.","Clouds",null,"https://en.wikipedia.org/wiki/Bunt_(DJ)"],
  ["emerging","salute","Joy",null,"https://saluteaut.bandcamp.com/"],
  ["emerging","ATRIP","Rainbow",null,"https://atrip.bandcamp.com/"],
  ["emerging","Barry Can't Swim","Sunsleeper","house","https://www.rollingstone.co.uk/music/barry-cant-swim-london-roundhouse-live-review-when-will-we-land-37495/"],
  ["adjacent","Underworld","Rez",null,"https://en.wikipedia.org/wiki/Rez_(song)"],
  ["adjacent","The Chemical Brothers","Hey Boy Hey Girl",null,"https://en.wikipedia.org/wiki/Hey_Boy_Hey_Girl"],
  ["adjacent","Armin van Buuren","Blah Blah Blah","non_house","https://en.wikipedia.org/wiki/Blah_Blah_Blah_(Armin_van_Buuren_song)",184000],
  ["adjacent","Chase & Status","Baddadan",null,"https://en.wikipedia.org/wiki/Baddadan"],
  ["unrelated","The Beatles","Let It Be","non_house","https://en.wikipedia.org/wiki/Let_It_Be_(song)"],
  ["unrelated","Queen","We Will Rock You","non_house","https://en.wikipedia.org/wiki/We_Will_Rock_You",122000],
  ["unrelated","Metallica","Nothing Else Matters","non_house","https://en.wikipedia.org/wiki/Nothing_Else_Matters",388000],
  ["unrelated","Taylor Swift","Anti-Hero","non_house","https://en.wikipedia.org/wiki/Anti-Hero_(song)",200000],
];
export const HOLDOUT:Case[]=raw.map(([group,artist,title,gold,reference,durationMs],i)=>({id:`fresh-${String(i+1).padStart(2,"0")}`,group,artist,title,gold,reference,durationMs,note:gold===null?"Identity/reference candidate; exact-version genre gold is unresolved. Excluded from accuracy metrics.":"Track-specific independent genre reference; audio identity is not independently audited."}));
