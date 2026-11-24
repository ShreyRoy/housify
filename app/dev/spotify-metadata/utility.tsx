"use client";

import { useRef, useState } from "react";

export function MetadataDiagnostic() {
  const [input, setInput] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (abort.current) return;
    let playlistId = input.trim();
    try { const url = new URL(playlistId); if (url.hostname !== "open.spotify.com" || !url.pathname.startsWith("/playlist/")) throw new Error(); playlistId = url.pathname.split("/")[2]; } catch { /* A bare ID is also accepted. */ }
    if (!/^[a-zA-Z0-9]{22}$/.test(playlistId)) { setMessage("Paste a Spotify playlist URL or its 22-character ID."); return; }
    const controller = new AbortController(); abort.current = controller;
    setRunning(true); setMessage(null); setReport(null);
    try {
      const response = await fetch("/api/dev/spotify-metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playlistId }), cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(195000)]) });
      const body = await response.json();
      if (!response.ok) { setMessage(body.message || "Diagnostic failed."); return; }
      setReport(JSON.stringify(body, null, 2));
      setMessage(`Sampled ${body.sampledTracks} of 5 tracks. Raw responses and field summary are below and in the development server terminal. Missing/failed probes are reported, not hidden.`);
    } catch { setMessage(controller.signal.aborted ? "Diagnostic cancelled. Start a new run when ready." : "The diagnostic timed out or lost its connection. Check the development server and try again."); }
    finally { abort.current = null; setRunning(false); }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "housify-spotify-metadata-diagnostic.json"; link.click(); URL.revokeObjectURL(url);
  }
  return <main style={{ padding: "40px 24px", maxWidth: 1100, margin: "auto" }}>
    <a href="/dashboard" className="spotify-text-link">← Your playlists</a>
    <h1 style={{ fontSize: 34, letterSpacing: -1, margin: "28px 0 18px" }}>Spotify metadata diagnostic</h1>
    <p style={{ lineHeight: 1.8 }}>Development only. Samples five song entries, then fetches full tracks, all credited artists, albums and audio-feature availability. No fields filters, classifier, MusicBrainz requests or production transformations. Duplicate entity IDs are fetched once.</p>
    <p style={{ lineHeight: 1.8, color: "#b8c7ac" }}>Use a playlist ID from your Housify playlist URL or paste a Spotify playlist link. Results stay in memory unless you download them; the requested raw report is also printed in your dev terminal. It contains private playlist metadata, with credentials redacted.</p>
    <form onSubmit={run} style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "24px 0" }}>
      <label htmlFor="diagnostic-playlist" style={{ width: "100%" }}>Playlist URL or ID</label>
      <input id="diagnostic-playlist" value={input} onChange={event => setInput(event.target.value)} disabled={running} placeholder="https://open.spotify.com/playlist/…" required style={{ flex: "1 1 300px", padding: 14, border: "1px solid #59634f", borderRadius: 8, background: "#171d15", color: "#fff" }}/>
      <button className="button button-primary" type="submit" disabled={running}>{running ? "Inspecting Spotify metadata…" : "Inspect five tracks"}</button>
      {running && <button className="button button-ghost" type="button" onClick={() => abort.current?.abort()}>Cancel</button>}
    </form>
    {running && <p role="status">Fetching sequentially with per-request timeouts. This run stops on rate limiting or after its three-minute deadline.</p>}
    {message && <p role="status" style={{ lineHeight: 1.8 }}>{message}</p>}
    {report && <><button className="button button-ghost" onClick={download}>Download redacted JSON</button><h2 style={{ margin: "25px 0 14px" }}>Complete raw responses and field summary</h2><pre tabIndex={0} aria-label="Raw Spotify diagnostic report" style={{ fontSize: 12, lineHeight: 1.7, padding: 20, border: "1px solid #394231", borderRadius: 10, maxHeight: "70vh", overflow: "auto", background: "#11150f" }}>{report}</pre></>}
  </main>;
}
