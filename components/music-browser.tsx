"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Clock3, Headphones } from "lucide-react";
import { Button, Eyebrow } from "./ui";
import { Artwork, MusicSkeleton } from "./music-primitives";
import { PlaylistCard } from "./playlist-card";
import { TrackRow } from "./track-row";
import { PlaylistAnalysis } from "./playlist-analysis";
import type { ApiProblem, LibraryData, PlaylistData } from "@/lib/spotify/types";

function useSpotifyData<T>(endpoint: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<(ApiProblem & { status: number }) | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(null);
    (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          const problem: ApiProblem = await response.json();
          if (response.status === 429 && problem.retryAfter) {
            setRemaining(problem.retryAfter);
            setWaitUntil(Date.now() + problem.retryAfter * 1000);
          }
          setError({ ...problem, status: response.status });
          return;
        }
        setData(await response.json());
      } catch {
        if (!controller.signal.aborted) setError({ message: "We couldn’t reach Housify. Check your connection and try again.", status: 0 });
      }
    })();
    return () => controller.abort();
  }, [endpoint, attempt]);
  useEffect(() => {
    if (!waitUntil) return;
    const timer = setInterval(() => {
      const seconds = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));
      setRemaining(seconds);
      if (!seconds) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [waitUntil]);
  return { data, error, remaining, retry: () => setAttempt(value => value + 1) };
}

function BrowserError({ error, remaining, retry, playlistId }: { error: ApiProblem & { status: number }; remaining: number; retry: () => void; playlistId?: string }) {
  return <section className="music-empty" role="alert"><Headphones size={30}/><h2>{error.status === 401 ? "Let’s reconnect." : error.status === 403 ? "This one has limited access." : error.status === 429 ? "A brief intermission." : "The music will be back."}</h2><p>{error.message}</p>{error.status === 401 ? <a href="/api/auth/login" className="button button-primary">Reconnect with Spotify</a> : <Button onClick={retry} disabled={remaining > 0}>{remaining ? `Try again in ${remaining}s` : "Try again"}</Button>}{playlistId && <a className="spotify-text-link" href={`https://open.spotify.com/playlist/${encodeURIComponent(playlistId)}`} target="_blank" rel="noopener noreferrer">Open playlist in Spotify <ArrowUpRight size={14}/></a>}</section>;
}

export function LibraryBrowser() {
  const { data, error, remaining, retry } = useSpotifyData<LibraryData>("/api/spotify/library");
  return <><div className="library-heading"><Eyebrow><span className="tiny-dot"/> YOUR LISTENING ROOM</Eyebrow><h1>{data ? <>Welcome back, <span>{data.user.name}.</span></> : "Your next deep dive."}</h1><p>Your collection is the starting point. Pick a playlist and take a closer listen.</p>{data && <a href={data.user.url} className="spotify-text-link" target="_blank" rel="noopener noreferrer">Your Spotify profile <ArrowUpRight size={13}/></a>}</div><div className="library-toolbar"><h2>Your playlists</h2><span>{data ? `${data.playlists.length} playlists` : "Finding your collection…"}</span></div><p className="access-explainer">Track browsing is available for playlists you own or collaborate on. Other playlists can be opened in Spotify.</p>{error ? <BrowserError error={error} remaining={remaining} retry={retry}/> : !data ? <MusicSkeleton/> : !data.playlists.length ? <div className="music-empty"><Headphones size={30}/><h2>A fresh start.</h2><p>No playlists were returned for this account. Create or follow playlists in Spotify, then refresh your collection here.</p><Button onClick={retry}>Refresh collection</Button></div> : <div className="playlist-grid">{data.playlists.map(playlist => <PlaylistCard key={playlist.id} playlist={playlist}/>)}</div>}<div className="phase-note">Open a playlist to analyze its tracks with MusicBrainz genre evidence. No playlists are changed.</div></>;
}

export function PlaylistBrowser({ id }: { id: string }) {
  const { data, error, remaining, retry } = useSpotifyData<PlaylistData>(`/api/spotify/playlist/${encodeURIComponent(id)}`);
  return <><Link className="back-link" href="/dashboard"><ArrowLeft size={16}/> Your collection</Link>{error ? <BrowserError error={error} remaining={remaining} retry={retry} playlistId={id}/> : !data ? <><div className="playlist-heading skeleton playlist-heading-skeleton"/><MusicSkeleton tracks/></> : <><section className="playlist-heading"><Artwork src={data.playlist.image} label={`${data.playlist.name} cover`}/><div><Eyebrow>FROM YOUR SPOTIFY COLLECTION</Eyebrow><h1>{data.playlist.name}</h1><p>By {data.playlist.owner} <span>·</span> {data.tracks.length.toLocaleString()} items loaded</p><a className="spotify-text-link" href={data.playlist.url} target="_blank" rel="noopener noreferrer">Open in Spotify <ArrowUpRight size={14}/></a></div></section><PlaylistAnalysis key={id} playlistId={id} tracks={data.tracks}/><div className="library-toolbar"><h2>The tracklist</h2><span>Original playlist order</span></div><p className="access-explainer">Unavailable songs, local files, and non-track items retain their place in the list. Playback isn’t enabled. Analyze above to review house classifications.</p>{!data.tracks.length ? <div className="music-empty"><h2>No tracks here yet.</h2><p>This playlist is empty. Add tracks in Spotify and reload to see them here.</p></div> : <div className="track-table-wrap"><table className="track-table"><caption className="sr-only">Tracks in {data.playlist.name}, in original Spotify order</caption><thead><tr><th scope="col">#</th><th scope="col">Track / artist</th><th className="album-column" scope="col">Album</th><th scope="col"><Clock3 size={14} aria-label="Duration"/></th><th scope="col"><span className="sr-only">Spotify link</span></th></tr></thead><tbody>{data.tracks.map(track => <TrackRow key={track.position} track={track}/>)}</tbody></table></div>}</>}</>;
}
