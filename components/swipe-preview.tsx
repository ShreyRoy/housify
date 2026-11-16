"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { mockTracks } from "@/lib/mock-tracks";

export function SwipePreview() {
  const [decisions, setDecisions] = useState<boolean[]>([]);
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const index = decisions.length;
  const track = mockTracks[Math.min(index, mockTracks.length - 1)];
  const done = index === mockTracks.length;
  function decide(include: boolean) { if (!done) setDecisions(previous => [...previous, include]); setDrag(0); }
  return <section id="preview" className="preview" aria-label="Interactive mock swipe preview">
    <div className="preview-heading"><span><i/> THE LISTENING ROOM</span><span className="demo-badge">INTERACTIVE DEMO</span></div>
    <div className="preview-body">
      <div className="preview-meta"><span><span className="tiny-dot"/> Iffy house</span><span>{Math.min(index + 1, 3)} <span className="muted">/ 03</span></span></div>
      {done ? <div className="demo-complete"><div className="complete-icon"><Check size={30}/></div><h3>Good ears.</h3><p>You included {decisions.filter(Boolean).length} of 3 mock tracks.</p><p className="muted">In the full experience, you’ll review your selections before confirming playlist creation.</p><button className="text-button" onClick={() => setDecisions([])}>Try the demo again <RotateCcw size={15}/></button></div> : <div className="track-card" style={{ transform: `translateX(${drag}px) rotate(${drag / 18}deg)` }} onPointerDown={event => { start.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (start.current !== null) setDrag(Math.max(-100, Math.min(100, event.clientX - start.current))); }} onPointerUp={() => { if (Math.abs(drag) > 55) decide(drag > 0); start.current = null; setDrag(0); }} onPointerCancel={() => { start.current = null; setDrag(0); }}>
        <div className={`cover-art cover-${track.color}`}><div className="cover-grid"/><div className="record"><div className="record-center"><span>SC</span><small>33⅓ RPM</small></div></div><span className="cover-top">{track.artist}</span><span className="cover-bottom">{track.release}<ArrowDown size={19}/></span><span className="cover-catalog">H.001 — STEREO</span></div>
        <div className="track-info"><div><h3>{track.title}</h3><p>{track.artist}</p></div><span className="track-duration">{track.duration}</span></div>
        <div className="track-tags"><span>{track.genre}</span><span>{track.year}</span><span className="mock-label">Fictional track</span></div>
      </div>}
      <div className="swipe-actions"><button className="decision skip" aria-label="Skip mock track" disabled={done} onClick={() => decide(false)}><X size={23}/></button><button className="undo" aria-label="Undo last decision" disabled={!index} onClick={() => setDecisions(previous => previous.slice(0, -1))}><RotateCcw size={19}/></button><button className="decision include" aria-label="Include mock track" disabled={done} onClick={() => decide(true)}><Check size={24}/></button></div>
      <div className="swipe-labels"><span><ArrowLeft size={12}/> Skip</span><span>Undo</span><span>Keep <ArrowRight size={12}/></span></div>
    </div>
    <div className="preview-footer"><span className="tiny-dot"/> A taste of what’s coming. All data is mocked.</div>
    <div className="floating-note"><span className="note-icon"><Check size={15}/></span><div>Your playlist, refined.<small>Keep only what moves you.</small></div></div>
  </section>;
}
