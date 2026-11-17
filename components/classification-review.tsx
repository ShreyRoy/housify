"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, LoaderCircle, RotateCcw, Square, X } from "lucide-react";
import { Button, Eyebrow } from "./ui";
import { fixturePlaylist, FIXTURE_CATALOG, TRANSIENT_FAILURE_ID } from "@/lib/classification/fixtures";
import { EnrichmentService } from "@/lib/classification/enrichment";
import { FixtureProvider } from "@/lib/classification/providers";
import { analyzeTracks } from "@/lib/classification/runner";
import { restoreAnalysis, saveAnalysis, STORAGE_KEY } from "@/lib/classification/storage";
import { CATEGORIES, type Category, type ClassificationResult, type IndependentTrack } from "@/lib/classification/types";
import { ResultRow } from "./classification-result-row";

const labels: Record<Category, string> = { DEFINITELY_HOUSE: "Definitely House", IFFY_HOUSE: "Iffy House", NOT_HOUSE: "Not House" };
const icons = { DEFINITELY_HOUSE: Check, IFFY_HOUSE: CircleHelp, NOT_HOUSE: X };
const PAGE_SIZE = 40;


export function ClassificationReview() {
  const [size, setSize] = useState<"sample" | "large">("sample");
  const tracks = useMemo(() => fixturePlaylist(size), [size]);
  const [results, setResults] = useState<Record<string, ClassificationResult>>({});
  const resultsRef = useRef(results);
  const [overrides, setOverrides] = useState<Record<string, Category>>({});
  const [active, setActive] = useState<Category>("DEFINITELY_HOUSE");
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<"idle" | "running" | "paused" | "done">("idle");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const service = useRef<EnrichmentService | null>(null);
  const [runProgress, setRunProgress] = useState<{ completed: number; total: number } | null>(null);

  useEffect(() => {
    service.current = new EnrichmentService(new FixtureProvider(FIXTURE_CATALOG, [TRANSIENT_FAILURE_ID]));
    try {
      const saved = restoreAnalysis(sessionStorage.getItem(STORAGE_KEY));
      if (saved) { setSize(saved.size); resultsRef.current = saved.results; setResults(saved.results); setOverrides(saved.overrides); setStatus(Object.keys(saved.results).length === fixturePlaylist(saved.size).length ? "done" : "paused"); }
    } catch { setStorageNotice("Browser storage is unavailable. Results will last for this page visit only."); }
    setReady(true);
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(STORAGE_KEY, saveAnalysis({ size, results, overrides })); }
    catch { setStorageNotice("Browser storage is full or unavailable. Current results are safe in memory, but may not survive a reload."); }
  }, [ready, size, results, overrides]);

  async function run(mode: "remaining" | "failed") {
    if (controller.current || !service.current) return;
    const pending = tracks.filter(track => mode === "failed" ? resultsRef.current[track.id]?.retryable : !resultsRef.current[track.id]);
    if (!pending.length) return;
    const abort = new AbortController(); controller.current = abort;
    setStatus("running"); setError(null); setRunProgress({ completed: 0, total: pending.length });
    try {
      await analyzeTracks(pending, service.current, abort.signal, (result, index) => {
        resultsRef.current[result.trackId] = result;
        if ((index + 1) % 20 === 0 || index === pending.length - 1) { setResults({ ...resultsRef.current }); setRunProgress({ completed: index + 1, total: pending.length }); }
      }, mode === "failed");
      setStatus("done");
    } catch {
      setStatus("paused");
      if (!abort.signal.aborted) setError("Analysis paused after an unexpected error. Completed results are preserved; resume the remaining tracks.");
    } finally {
      setResults({ ...resultsRef.current });
      controller.current = null; setRunProgress(null);
    }
  }

  function reset(nextSize: "sample" | "large") {
    if (controller.current) return;
    setSize(nextSize); resultsRef.current = {}; setResults({}); setOverrides({}); setStatus("idle"); setPage(0); setError(null);
  }
  const completed = Object.keys(results).length;
  const failed = Object.values(results).filter(result => result.retryable).length;
  const groups = useMemo(() => {
    const groups: Record<Category, { track: IndependentTrack; result: ClassificationResult; position: number }[]> = { DEFINITELY_HOUSE: [], IFFY_HOUSE: [], NOT_HOUSE: [] };
    tracks.forEach((track, index) => { const result = results[track.id]; if (result) groups[overrides[track.id] || result.category].push({ track, result, position: index + 1 }); });
    return groups;
  }, [tracks, results, overrides]);
  const rows = groups[active];
  const safePage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  return <>
    <section className="analysis-intro"><Eyebrow><span className="tiny-dot"/> THE CLASSIFICATION LAB</Eyebrow><h1>A clearer picture.<br/><span>With the evidence to match.</span></h1><p>Explore Housify’s explainable house rules with independent, fictional recordings. This lab uses no Spotify data and contacts no external services.</p><div className="fixture-banner"><CircleHelp size={17}/><span>Independent fixture mode · not an analysis of your Spotify playlist</span></div></section>
    <section className="analysis-control-panel"><div className="analysis-panel-heading"><div><h2>Independent collection</h2><p>{tracks.length.toLocaleString()} fictional tracks · recording, release and artist evidence</p></div><div className="analysis-controls"><label className="sr-only" htmlFor="fixture-size">Choose fixture collection (resets current results)</label><select id="fixture-size" value={size} onChange={event => reset(event.target.value as "sample" | "large")} disabled={status === "running" || !ready}><option value="sample">18-track sample</option><option value="large">3,000-track scale test</option></select>{status === "running" ? <Button variant="ghost" onClick={() => controller.current?.abort()}><Square size={13}/> Cancel</Button> : completed < tracks.length ? <Button disabled={!ready} onClick={() => run("remaining")}>{completed ? "Resume analysis" : "Analyze independent playlist"}</Button> : <Button variant="ghost" onClick={() => reset(size)}><RotateCcw size={14}/> Reset demo</Button>}</div></div>
      <div className="analysis-progress-copy" role="status" aria-live="polite"><span>{status === "running" && <LoaderCircle size={13} className="analysis-spinner"/>}{status === "idle" ? "Ready when you are" : status === "running" ? "Reading independent evidence" : status === "paused" ? "Paused · resume when ready" : "Analysis complete"}</span><span>{completed.toLocaleString()} / {tracks.length.toLocaleString()} completed{runProgress && completed === tracks.length ? ` · retry ${runProgress.completed}/${runProgress.total}` : ""}</span></div><progress className="analysis-progress" value={completed} max={tracks.length} aria-label="Tracks analyzed"/>
      <p className="analysis-disclaimer">Definitely House is included by default; Iffy House needs review; Not House is excluded. These are heuristic decisions, not calibrated probabilities. No playlist is created.</p>
      {failed > 0 && <div className="analysis-retry"><span>{failed} lookup{failed === 1 ? "" : "s"} failed. Those tracks remain Iffy House.</span><button disabled={status === "running"} onClick={() => run("failed")}>Retry failed tracks only <RotateCcw size={12}/></button></div>}
      {storageNotice && <p className="analysis-warning" role="status">{storageNotice}</p>}{error && <p className="analysis-warning" role="alert">{error}</p>}
    </section>
    <div className="analysis-results-heading"><h2>The results</h2><span>{groups.DEFINITELY_HOUSE.length.toLocaleString()} included by current choices · original order retained</span></div>
    <div className="classification-tabs" role="tablist" aria-label="Classification results">{CATEGORIES.map(category => { const Icon = icons[category]; return <button key={category} id={`tab-${category}`} role="tab" type="button" aria-selected={active === category} aria-controls={`panel-${category}`} tabIndex={active === category ? 0 : -1} className={`category-${category.toLowerCase()}`} onClick={() => { setActive(category); setPage(0); }} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const index = event.key === "Home" ? 0 : event.key === "End" ? 2 : (CATEGORIES.indexOf(category) + (event.key === "ArrowRight" ? 1 : 2)) % 3; setActive(CATEGORIES[index]); setPage(0); document.getElementById(`tab-${CATEGORIES[index]}`)?.focus(); }}><Icon size={16}/><span>{labels[category]}</span><strong>{groups[category].length.toLocaleString()}</strong></button>; })}</div>
    <section id={`panel-${active}`} role="tabpanel" aria-labelledby={`tab-${active}`} tabIndex={0} className="classification-panel"><p className="review-intro">{active === "IFFY_HOUSE" ? "The maybes deserve a closer look. Read the evidence and make your own call; swipe review comes later." : active === "DEFINITELY_HOUSE" ? "Strong recording-specific evidence, or your manual choices. Every decision is open for review." : "Strong evidence of another genre, or your manual choices. You can move any track back into review."}</p>{!rows.length ? <div className="analysis-empty"><CircleHelp size={25}/><h3>{!completed ? "The evidence starts here." : "No tracks in this group yet."}</h3><p>{!completed ? "Start the independent analysis to see explainable results." : status === "running" ? "Analysis is still running. Counts will update as tracks complete." : "Switch tabs to explore the rest of the collection."}</p></div> : rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map(({ track, result, position }) => <ResultRow key={track.id} track={track} position={position} result={result} override={overrides[track.id]} onOverride={category => setOverrides(previous => { const updated = { ...previous }; if (category) updated[track.id] = category; else delete updated[track.id]; return updated; })}/>)}{rows.length > PAGE_SIZE && <nav className="analysis-pagination" aria-label="Result pages"><button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><ChevronLeft size={16}/> Previous</button><span>{safePage * PAGE_SIZE + 1}–{Math.min(rows.length, (safePage + 1) * PAGE_SIZE)} of {rows.length.toLocaleString()}</span><button disabled={(safePage + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(safePage + 1)}>Next <ChevronRight size={16}/></button></nav>}</section>
    <p className="analysis-retention-note">Only this independent demo’s results and manual choices are saved in this tab’s session storage. Refresh never starts a new analysis; incomplete work can be resumed. Resetting or changing collection clears the current demo.</p>
  </>;
}
