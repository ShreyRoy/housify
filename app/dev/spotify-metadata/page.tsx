import { notFound } from "next/navigation";
import { requireSession } from "@/lib/spotify/require-session";
import { diagnosticsEnabled } from "@/lib/diagnostics/spotify-metadata";
import { MetadataDiagnostic } from "./utility";

export const dynamic = "force-dynamic";
export default async function SpotifyMetadataDiagnostic() {
  if (!diagnosticsEnabled(process.env.NODE_ENV)) notFound();
  await requireSession();
  return <MetadataDiagnostic/>;
}
