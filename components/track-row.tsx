import { ArrowUpRight } from "lucide-react";
import type { TrackView } from "@/lib/spotify/types";
import { Artwork } from "./music-primitives";

function duration(milliseconds: number | null) {
  if (milliseconds === null) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
const labels = { unavailable: "Unavailable", local: "Local file", "non-track": "Non-track item", track: "" };

export function TrackRow({ track }: { track: TrackView }) {
  return <tr><td className="track-position">{track.position}</td><td><div className="track-cell"><Artwork src={track.image} label={track.album ? `${track.album} album artwork` : "Album artwork"}/><div><span className="song-title">{track.title}</span><span className="song-artist">{track.artists}</span>{track.status !== "track" && <span className="track-status">{labels[track.status]}</span>}</div></div></td><td className="album-column">{track.album || "—"}</td><td className="duration-cell">{duration(track.duration)}</td><td className="track-link">{track.url && <a href={track.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${track.title} in Spotify`}><ArrowUpRight size={17}/></a>}</td></tr>;
}
