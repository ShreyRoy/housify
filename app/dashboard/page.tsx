import { MusicShell } from "@/components/music-shell";
import { LibraryBrowser } from "@/components/music-browser";
import { requireSession } from "@/lib/spotify/require-session";

export default async function Dashboard() {
  await requireSession();
  return <MusicShell><LibraryBrowser/></MusicShell>;
}
