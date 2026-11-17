"use client";

import { useState } from "react";
import { Music2 } from "lucide-react";

export function Artwork({ src, label, className = "" }: { src: string | null; label: string; className?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <div className={`artwork ${className}`}>{src && failedSource !== src ? <img src={src} alt={label} onError={() => setFailedSource(src)} loading="lazy"/> : <Music2 aria-label="No artwork available" size={28}/>}</div>;
}

export function MusicSkeleton({ tracks = false }: { tracks?: boolean }) {
  return <div role="status" aria-label={tracks ? "Loading playlist tracks" : "Loading your Spotify playlists"}><span className="sr-only">Loading your music…</span><div className={tracks ? "track-skeletons" : "playlist-grid"}>{Array.from({ length: tracks ? 8 : 6 }, (_, i) => <div key={i} className={tracks ? "skeleton track-skeleton" : "skeleton playlist-skeleton"}/>)}</div></div>;
}
