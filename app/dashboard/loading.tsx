import { MusicShell } from "@/components/music-shell";
import { MusicSkeleton } from "@/components/music-primitives";

export default function Loading() { return <MusicShell><div className="library-heading"><h1>Your next deep dive.</h1></div><MusicSkeleton/></MusicShell>; }
