import { notFound } from "next/navigation";
import { MusicShell } from "@/components/music-shell";
import { PlaylistBrowser } from "@/components/music-browser";
import { requireSession } from "@/lib/spotify/require-session";

export default async function Playlist({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!/^[a-zA-Z0-9]{22}$/.test(id)) notFound();
  return <MusicShell><PlaylistBrowser id={id}/></MusicShell>;
}
