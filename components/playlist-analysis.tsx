"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, CircleHelp, LoaderCircle, RotateCcw, Square, X } from "lucide-react";
import { Button } from "./ui";
import { ResultRow } from "./classification-result-row";
import { spotifyInput } from "@/lib/classification/spotify-input";
import { recordingKey } from "@/lib/classification/recording-key";
import { saveLiveAnalysis, restoreLiveAnalysis } from "@/lib/classification/live-storage";
import { CATEGORIES, type Category, type ClassificationResult } from "@/lib/classification/types";
import type { TrackView } from "@/lib/spotify/types";

const labels: Record<Category, string> = { DEFINITELY_HOUSE: "Definitely House", IFFY_HOUSE: "Iffy House", NOT_HOUSE: "Not House" };
const icons = { DEFINITELY_HOUSE: Check, IFFY_HOUSE: CircleHelp, NOT_HOUSE: X };
const PAGE_SIZE = 40;

export function PlaylistAnalysis({ playlistId, tracks }: { playlistId: string; tracks: TrackView[] }) {
  const inputs = useMemo(() => tracks.map(spotifyInput), [tracks]);
  const [results, setResults] = useState<Record<string, ClassificationResult>>({});
  const resultsRef = useRef(results);
  const [overrides, setOverrides] = useState<Record<string, Category>>({});
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const [ready, setReady] = useState(false);
  const [manifest, setManifest] = useState("");
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [active, setActive] = useState<Category>("DEFINITELY_HOUSE");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ title: string; since: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const storageKey = `housify-live-analysis:${playlistId}`;

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(inputs)));
        const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        if (disposed) return;
        setManifest(fingerprint);
        const saved = restoreLiveAnalysis(sessionStorage.getItem(storageKey), fingerprint, new Set(inputs.map(track => track.id)));
        if (saved) { resultsRef.current = saved.results; setResults(saved.results); setOverrides(saved.overrides); setStarted(Object.keys(saved.results).length > 0); }
      } catch { if (!disposed) setStorageNotice("Session storage is unavailable. Results remain in memory for this visit; refresh may discard them."); }
      if (!disposed) setReady(true);
    })();
    return () => { disposed = true; abortRef.current?.abort(); };
  }, [inputs, storageKey]);

  useEffect(() => {
    if (!ready || !manifest) return;
    const timer = setTimeout(() => {
      try { sessionStorage.setItem(storageKey, saveLiveAnalysis(manifest, { results, overrides })); }
      catch { setStorageNotice("Session storage is full or unavailable. Current results still work, but may not survive refresh."); }
    }, 150);
    return () => clearTimeout(timer);
  }, [ready, manifest, storageKey, results, overrides]);
  useEffect(() => {
    if (!current && !cooldown) return;
    const update = () => { setElapsed(current ? Math.floor((Date.now() - current.since) / 1000) : 0); setWaitSeconds(Math.max(0, Math.ceil((cooldown - Date.now()) / 1000))); };
    update(); const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [current, cooldown]);

  async function run(retryFailed = false) {
    if (abortRef.current || !ready || waitSeconds) return;
    const pending = inputs.filter(track => retryFailed ? resultsRef.current[track.id]?.retryable : !resultsRef.current[track.id]);
    if (!pending.length) return;
    const controller = new AbortController(); abortRef.current = controller;
    setRunning(true); setStarted(true); setError(null);
    const duplicateCache = new Map<string, ClassificationResult>();
    inputs.forEach(track => { const result = resultsRef.current[track.id]; if (result && !result.retryable) duplicateCache.set(recordingKey(track), result); });
    let consecutiveFailures = 0;
    try {
      for (const track of pending) {
        controller.signal.throwIfAborted();
        setCurrent({ title: track.title, since: Date.now() });
        const key = recordingKey(track);
        let result = duplicateCache.get(key);
        if (result) result = { ...result, trackId: track.id, spotifyTrackId: track.spotifyTrackId || null };
        else {
          // A hard per-row deadline prevents an endless spinner if a route or
          // external server stalls. Partial results stay visible and resumable.
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(75000)]);
          const response = await fetch("/api/analysis/track", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track, retry: retryFailed }), signal });
          if (!response.ok) { const problem = await response.json(); throw new Error(problem.message || "The lookup could not complete. Resume when ready."); }
          result = await response.json() as ClassificationResult;
          if (result.trackId !== track.id || result.spotifyTrackId !== (track.spotifyTrackId || null) || !CATEGORIES.includes(result.category)) throw new Error("The analysis response did not match this playlist entry. Reload before continuing.");
          if (!result.retryable) duplicateCache.set(key, result);
        }
        resultsRef.current = { ...resultsRef.current, [track.id]: result };
        setResults(resultsRef.current);
        consecutiveFailures = result.metadataStatus === "failed" ? consecutiveFailures + 1 : 0;
        if (result.retryAfter) { setCooldown(Date.now() + result.retryAfter * 1000); setError("MusicBrainz requested a cooldown. Completed results are preserved; retry failed tracks after the countdown, then resume the remaining tracks."); break; }
        if (consecutiveFailures >= 3) { setError("Three consecutive metadata requests failed. Analysis paused to avoid repeating requests against an unavailable service. Retry failed tracks or resume later."); break; }
        if (duplicateCache.has(key)) await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error && problem.name !== "TimeoutError" ? problem.message : "The track lookup reached its 75-second deadline. Partial results are preserved; resume to try the unfinished track again.");
    } finally {
      setRunning(false); setCurrent(null); abortRef.current = null;
      try { if (manifest) sessionStorage.setItem(storageKey, saveLiveAnalysis(manifest, { results: resultsRef.current, overrides: overridesRef.current })); } catch { /* The persistence effect displays storage failures. */ }
    }
  }

  const completed = Object.keys(results).length;
  const failed = Object.values(results).filter(result => result.retryable).length;
  const groups = useMemo(() => {
    const groups: Record<Category, number[]> = { DEFINITELY_HOUSE: [], IFFY_HOUSE: [], NOT_HOUSE: [] };
    inputs.forEach((track, index) => { const result = results[track.id]; if (result) groups[overrides[track.id] || result.category].push(index); });
    return groups;
  }, [inputs, results, overrides]);
  const rows = groups[active];
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));

  return <section className="live-analysis" aria-label="Analyze this Spotify playlist">
    <div className="analysis-control-panel"><div className="analysis-panel-heading"><div><h2>Find the house in this playlist.</h2><p>{tracks.length.toLocaleString()} real playlist entries · MusicBrainz genre evidence</p></div><div className="analysis-controls">{running ? <Button variant="ghost" onClick={() => abortRef.current?.abort()}><Square size={13}/> Cancel analysis</Button> : completed < tracks.length ? <Button disabled={!ready || !tracks.length || waitSeconds > 0} onClick={() => run()}>{waitSeconds ? `Wait ${waitSeconds}s` : completed ? "Resume analysis" : "Analyze Playlist"}</Button> : <span className="analysis-done"><Check size={16}/> All entries processed</span>}{failed > 0 && <Button variant="ghost" disabled={running || waitSeconds > 0} onClick={() => run(true)}><RotateCcw size={13}/> Retry {failed} lookup{failed === 1 ? "" : "s"}</Button>}</div></div>
      <p className="analysis-disclaimer">Sends song titles, artist names and available ISRCs to MusicBrainz. No audio, artwork, Spotify tokens or account details are sent. Scores are heuristics, not probabilities. <Link href="/analysis-lab" className="spotify-text-link">Fictional demo lab ↗</Link></p>
      <details className="classification-explanation"><summary>API terms and metadata attribution</summary><p className="analysis-disclaimer">This personal integration is not officially approved by Spotify. Its content-analysis and third-party-transfer restrictions remain unresolved for this workflow. <a href="https://developer.spotify.com/policy" target="_blank" rel="noopener noreferrer" className="spotify-text-link">Spotify policy ↗</a> · Genre evidence comes from <a href="https://musicbrainz.org" target="_blank" rel="noopener noreferrer" className="spotify-text-link">MusicBrainz</a> community tags, licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/3.0/" target="_blank" rel="noopener noreferrer" className="spotify-text-link">CC BY-NC-SA 3.0</a>. No playlist is changed.</p></details>
      {(started || running) && <><div className="analysis-progress-copy" role="status" aria-live="polite"><span>{running && <LoaderCircle size={13} className="analysis-spinner"/>}{running ? `Matching “${current?.title || "next track"}” · ${elapsed}s` : completed === tracks.length ? "Processing complete" : "Paused · ready to resume"}</span><span>{completed.toLocaleString()} / {tracks.length.toLocaleString()} processed</span></div><progress className="analysis-progress" value={completed} max={Math.max(1, tracks.length)} aria-label="Playlist entries processed"/><p className="analysis-disclaimer">{failed ? `${failed} lookups need retry or manual review. ` : ""}Unmatched entries stay Iffy House. MusicBrainz allows at most one request per second; each unique song may need several requests, so large playlists can take hours. Cancel and resume anytime.</p></>}
      {waitSeconds > 0 && <p className="analysis-warning" role="status">MusicBrainz cooldown: {waitSeconds}s remaining.</p>}{error && <p className="analysis-warning" role="alert">{error}{error.includes("session") && <> <a href="/api/auth/login" className="spotify-text-link">Reconnect with Spotify</a></>}</p>}{storageNotice && <p className="analysis-warning" role="status">{storageNotice}</p>}
    </div>
    {started && <><div className="analysis-results-heading"><h2>Your results</h2><span>{groups.DEFINITELY_HOUSE.length.toLocaleString()} included by current choices · source order preserved</span></div><div role="tablist" aria-label="Playlist classification results" className="classification-tabs">{CATEGORIES.map(category => { const Icon = icons[category]; return <button type="button" role="tab" id={`live-tab-${category}`} aria-controls={`live-panel-${category}`} aria-selected={category === active} tabIndex={category === active ? 0 : -1} key={category} className={`category-${category.toLowerCase()}`} onClick={() => { setActive(category); setPage(0); }} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (CATEGORIES.indexOf(category) + (event.key === "ArrowRight" ? 1 : 2)) % 3; setActive(CATEGORIES[index]); setPage(0); document.getElementById(`live-tab-${CATEGORIES[index]}`)?.focus(); }}><Icon size={16}/><span>{labels[category]}</span><strong>{groups[category].length.toLocaleString()}</strong></button>; })}</div><div role="tabpanel" tabIndex={0} id={`live-panel-${active}`} aria-labelledby={`live-tab-${active}`} className="classification-panel"><p className="review-intro">{active === "IFFY_HOUSE" ? "Missing, ambiguous and conflicting evidence belongs here. Read the explanations and make your own call." : "Review the evidence or change any classification. Manual choices preserve the original engine score."}</p>{!rows.length ? <div className="analysis-empty"><CircleHelp size={24}/><h3>No entries in this category yet.</h3><p>{running ? "Results appear as each real track finishes." : "Check the other tabs or resume unfinished analysis."}</p></div> : rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map(index => { const track = inputs[index]; return <ResultRow key={track.id} track={{ ...track, image: tracks[index].image, url: tracks[index].url, album: tracks[index].album }} position={tracks[index].position} result={results[track.id]} override={overrides[track.id]} onOverride={category => setOverrides(previous => { const next = { ...previous }; if (category) next[track.id] = category; else delete next[track.id]; return next; })}/>; })}{rows.length > PAGE_SIZE && <nav className="analysis-pagination" aria-label="Analysis result pages"><button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ChevronLeft size={15}/> Previous</button><span>{safePage * PAGE_SIZE + 1}–{Math.min(rows.length, (safePage + 1) * PAGE_SIZE)} of {rows.length.toLocaleString()}</span><button disabled={(safePage + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(safePage + 1)}>Next <ChevronRight size={15}/></button></nav>}</div><div className="analysis-retention-note">Results and manual choices stay in this browser tab’s session storage for up to one hour of inactivity. Refresh never starts another analysis. A changed playlist invalidates saved results. <button className="text-button" disabled={running} onClick={() => { resultsRef.current = {}; setResults({}); setOverrides({}); setStarted(false); setError(null); sessionStorage.removeItem(storageKey); }}>Clear local results</button></div></>}
  </section>;
}
