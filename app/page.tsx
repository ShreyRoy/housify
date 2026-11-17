import { ArrowDown, ArrowRight, AudioLines, Check, Disc3, Layers3, SlidersHorizontal } from "lucide-react";
import { SpotifyConnect } from "@/components/spotify-connect";
import { SwipePreview } from "@/components/swipe-preview";
import { Eyebrow } from "@/components/ui";
import { AuthNotice } from "@/components/auth-notice";

export default function Home() {
  return <main>
    <div className="ambient" aria-hidden="true"/>
    <header className="site-header container"><a href="#" className="brand" aria-label="Housify home"><AudioLines size={26}/><span>housify<span className="brand-dot">.</span></span></a><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#preview">The experience <ArrowUpRightIcon/></a></nav><span className="phase-badge"><span className="tiny-dot"/> IN THE MAKING</span></header>
    <AuthNotice/>
    <section className="hero container">
      <div className="hero-copy"><Eyebrow><span className="tiny-dot"/> FOR THE LOVE OF THE FOUR-ON-THE-FLOOR</Eyebrow><h1>Your playlists.<br/>More <span className="house-word">house<svg viewBox="0 0 310 20" aria-hidden="true"><path d="M3 14Q140 0 303 9"/></svg></span>.</h1><p className="hero-description">The good stuff is already in your library.<br className="desktop-break"/> Find the house hiding in your Spotify playlists,<br className="desktop-break"/> and give it a place of its own.</p><SpotifyConnect/><div className="hero-footnote"><span><Check size={14}/> You’re always in control</span><span className="footnote-divider"/><span>No playlist changes without your say-so</span></div><a className="explore-link" href="#how-it-works"><span><ArrowDown size={15}/></span> A better kind of crate digging</a></div>
      <div className="hero-preview"><div className="preview-orbit" aria-hidden="true"/><SwipePreview/><div className="preview-caption"><span>LESS SEARCHING.</span><span>MORE FEELING.</span></div></div>
    </section>
    <section id="how-it-works" className="workflow container"><div className="section-heading"><div><Eyebrow>FROM MIXED BAG TO YOUR NEXT MIX</Eyebrow><h2>A little digging. A lot of discovery.</h2></div><p>The planned flow. Your music stays yours.</p></div><div className="steps"><article><div className="step-heading"><span className="step-icon"><Layers3 size={21}/></span><span>01 / THE SOURCE</span></div><h3>Start with your collection.</h3><p>Pick a Spotify playlist. Old favorites, late-night finds, that one mix with a bit of everything.</p></article><article><div className="step-heading"><span className="step-icon"><SlidersHorizontal size={21}/></span><span>02 / THE FEELING</span></div><h3>Find your four-on-the-floor.</h3><p>House across the spectrum. Clear matches get selected; you make the call on the maybes.</p><div className="classification"><span>Definitely house</span><span>Iffy house</span><span>Not house</span></div></article><article><div className="step-heading"><span className="step-icon"><Disc3 size={21}/></span><span>03 / THE NEW ROTATION</span></div><h3>One last look. Then let it play.</h3><p>Review every selection before you explicitly confirm a new playlist. Always your final say.</p></article></div></section>
    <section className="closing container"><AudioLines size={25}/><p>Deep. Soulful. Minimal. Melodic.<br/><span>If it feels like house, it belongs here.</span></p><a href="#preview">Find your frequency <ArrowRight size={17}/></a></section>
    <footer className="container"><a className="brand" href="#">housify<span className="brand-dot">.</span></a><p>Made for the music you keep coming back to.</p><span>PHASE 01 — CONCEPT PREVIEW</span></footer>
  </main>;
}

function ArrowUpRightIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.4"/></svg>; }
