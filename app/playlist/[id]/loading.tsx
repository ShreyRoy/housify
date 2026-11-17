import { MusicShell } from "@/components/music-shell";
import { MusicSkeleton } from "@/components/music-primitives";

export default function Loading() { return <MusicShell><div className="playlist-heading skeleton playlist-heading-skeleton"/><MusicSkeleton tracks/></MusicShell>; }
