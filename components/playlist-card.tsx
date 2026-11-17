import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { PlaylistView } from "@/lib/spotify/types";
import { Artwork } from "./music-primitives";

export function PlaylistCard({ playlist }: { playlist: PlaylistView }) {
  return <article className="playlist-card"><Link href={`/playlist/${playlist.id}`} className="playlist-select" aria-label={`Browse ${playlist.name}`}><Artwork src={playlist.image} label={`${playlist.name} playlist cover`}/><div className="playlist-card-copy"><h3>{playlist.name}</h3><p>{playlist.count === null ? "Track count unavailable" : `${playlist.count.toLocaleString()} items`}<span> · </span>{playlist.owner}</p><span className={playlist.accessible ? "access-label" : "access-label limited"}>{playlist.accessible ? "Ready to explore" : "Item access limited"}<ArrowRight size={14}/></span></div></Link><a className="spotify-text-link" href={playlist.url} target="_blank" rel="noopener noreferrer">Open in Spotify <ArrowUpRight size={12}/></a></article>;
}
