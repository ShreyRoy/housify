"use client";

import { Check, ChevronDown, RotateCcw, CircleHelp, X } from "lucide-react";
import { CATEGORIES, type Category, type ClassificationResult, type ClassificationTrack } from "@/lib/classification/types";
import { Artwork } from "./music-primitives";

const labels: Record<Category, string> = { DEFINITELY_HOUSE: "Definitely House", IFFY_HOUSE: "Iffy House", NOT_HOUSE: "Not House" };
const icons = { DEFINITELY_HOUSE: Check, IFFY_HOUSE: CircleHelp, NOT_HOUSE: X };

export function ResultRow({ track, position, result, override, onOverride }: { track: ClassificationTrack & { image?: string | null; url?: string | null; album?: string }; position: number; result: ClassificationResult; override?: Category; onOverride: (category?: Category) => void }) {
  const category = override || result.category;
  const Icon = icons[category];
  return <article className={`classification-row category-${category.toLowerCase()}`}>
    <span className="analysis-position">{position}</span>{track.provenance === "spotify-playlist" ? <Artwork src={track.image || null} label={track.album ? `${track.album} album artwork` : "Album artwork"}/> : <div className="fixture-art" aria-label="Fictional artwork"><span>{track.artists[0].split(" ").map(word => word[0]).slice(0, 2).join("")}</span></div>}
    <div className="classification-song"><h3>{track.title}</h3><p>{track.artists.join(", ")}</p><div className="evidence-chips">{result.matchedSubgenres.length ? result.matchedSubgenres.map(genre => <span key={genre}>{genre}</span>) : <span>{result.metadataStatus === "failed" ? "Lookup failed · retry available" : result.evidence.length ? "No confirmed house tags" : "No genre evidence"}</span>}</div>
      {track.url && <a className="spotify-text-link analysis-track-link" href={track.url} target="_blank" rel="noopener noreferrer">Open in Spotify ↗</a>}
      <details className="classification-explanation"><summary>Why this result? <ChevronDown size={12}/></summary><div><p><strong>{result.houseConfidence}/100 house score</strong> · heuristic, not a probability</p><p>{result.metadataSource} · match {result.matchConfidence}/100</p><ul>{result.explanation.map((text, index) => <li key={index}>{text}</li>)}</ul>{track.spotifyTrackId && <p>Spotify track ID: {track.spotifyTrackId}</p>}{result.evidence.length > 0 && <ul>{Array.from(new Set(result.evidence.map(item => item.source))).filter(source => source.startsWith("https://musicbrainz.org/")).map(source => <li key={source}><a className="spotify-text-link" href={source} target="_blank" rel="noopener noreferrer">View {source.includes("/recording/") ? "recording" : "release"} evidence on MusicBrainz ↗</a></li>)}</ul>}{override && <p className="manual-note">Your manual choice is {labels[override]}. The original engine result ({labels[result.category]}) and score are preserved.</p>}</div></details>
    </div><div className="classification-score"><Icon size={16}/><span>{result.houseConfidence}<small>/100</small></span><small>{category === "DEFINITELY_HOUSE" ? override ? "Included by you" : "Included by default" : category === "IFFY_HOUSE" ? "Review recommended" : override ? "Excluded by you" : "Excluded by default"}</small></div>
    <div className="classification-manual"><label className="sr-only" htmlFor={`class-${track.id}`}>Classification for {track.title}</label><select id={`class-${track.id}`} value={category} onChange={event => onOverride(event.target.value as Category)}>{CATEGORIES.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select>{override && <button onClick={() => onOverride()} className="reset-classification"><RotateCcw size={11}/> Use engine result</button>}</div>
  </article>;
}

