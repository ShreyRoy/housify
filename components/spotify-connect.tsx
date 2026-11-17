"use client";

import { ArrowUpRight } from "lucide-react";

export function SpotifyMark() {
  return <img src="/spotify-logo.svg" width="90" height="28" alt="Spotify" className="spotify-logo"/>;
}

export function SpotifyConnect() {
  return <div className="connect-wrap"><a className="button button-primary" href="/api/auth/login" aria-describedby="connect-note">Connect with Spotify <ArrowUpRight size={18}/></a><p id="connect-note" className="connect-note">Read-only access. Your playlists stay yours.</p></div>;
}
