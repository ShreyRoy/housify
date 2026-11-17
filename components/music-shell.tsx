import Link from "next/link";
import { AudioLines, ArrowUpRight } from "lucide-react";
import { SpotifyMark } from "./spotify-connect";

export function MusicShell({ children }: { children: React.ReactNode }) {
  return <main className="music-app"><div className="ambient" aria-hidden="true"/><header className="site-header container"><Link href="/dashboard" className="brand" aria-label="Housify library"><AudioLines size={26}/><span>housify<span className="brand-dot">.</span></span></Link><div className="music-header-actions"><span className="read-only"><span className="tiny-dot"/> READ-ONLY CONNECTION</span><form action="/api/auth/logout" method="post"><button className="logout-button" type="submit">Log out</button></form></div></header><div className="music-content container">{children}</div><footer className="container music-footer"><a href="https://open.spotify.com" target="_blank" rel="noopener noreferrer" aria-label="Open Spotify"><SpotifyMark/></a><p>Music and artwork provided by Spotify.</p><a href="https://www.spotify.com/account/apps/" target="_blank" rel="noopener noreferrer">Manage Spotify access <ArrowUpRight size={13}/></a></footer></main>;
}
