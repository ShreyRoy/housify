"use client";

import { useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { Button } from "./ui";

export function SpotifyMark() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="12"/><path d="M5.5 9c4-1.2 8.7-.8 13 1.4M6.3 12.4c3.6-1 7.5-.6 11 1.2M7 15.6c3-.7 6.2-.4 9 1" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

export function SpotifyConnect() {
  const [notice, setNotice] = useState(false);
  return <div className="connect-wrap"><Button onClick={() => setNotice(true)} aria-describedby="connect-note"><SpotifyMark /> Connect with Spotify <ArrowUpRight size={18}/></Button><p id="connect-note" className="connect-note">Your taste. Your playlists. A little more house.</p>{notice && <div className="connect-notice" role="status"><span>Spotify connection is coming in a future phase. This preview uses fictional tracks only.</span><button aria-label="Dismiss notice" onClick={() => setNotice(false)}><X size={16}/></button></div>}</div>;
}
