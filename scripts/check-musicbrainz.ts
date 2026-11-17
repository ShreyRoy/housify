// Optional live transport/provider check using an identifier published in
// MusicBrainz's own API docs. No Spotify account or playlist content is used.
import nextEnv from "@next/env";
import { MusicBrainzHttp, MusicBrainzProvider, musicBrainzUserAgent } from "../lib/classification/musicbrainz.ts";

nextEnv.loadEnvConfig(process.cwd());
const http = new MusicBrainzHttp(musicBrainzUserAgent(process.env.MUSICBRAINZ_CONTACT));
const signal = AbortSignal.timeout(60000);
const response = await http.get<{ recordings?: { id: string; title: string; length?: number; disambiguation?: string; "artist-credit"?: { artist?: { name?: string }; name?: string }[] }[] }>("isrc/JPB600601201", { inc: "artist-credits+isrcs" }, signal);
const recording = response?.recordings?.[0];
if (!recording) throw new Error("MusicBrainz returned no recording for its documented example ISRC.");
const version = recording.disambiguation && /\b(remix|mix|edit|dub|live|instrumental|version)\b/i.test(recording.disambiguation) ? ` (${recording.disambiguation})` : "";
const metadata = await new MusicBrainzProvider(http).lookup({
  id: "independently-sourced-live-probe", provenance: "spotify-playlist", spotifyTrackId: null,
  title: recording.title + version, artists: (recording["artist-credit"] || []).map(credit => credit.artist?.name || credit.name || "").filter(Boolean),
  isrc: "JPB600601201", durationMs: recording.length,
}, signal);
console.log({ transport: "MusicBrainz live HTTP", source: "MusicBrainz documentation example; not a user playlist", status: metadata.status, matchConfidence: metadata.matchConfidence, recordingTags: metadata.evidence.filter(tag => tag.level === "recording").length, releaseTags: metadata.evidence.filter(tag => tag.level === "release").length });
if (metadata.status !== "matched") throw new Error(`Live MusicBrainz probe did not produce a verified match: ${metadata.explanation}`);
