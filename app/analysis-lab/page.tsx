import Link from "next/link";
import { ArrowLeft, AudioLines } from "lucide-react";
import { ClassificationReview } from "@/components/classification-review";

export const metadata = { title: "Independent Classification Lab — Housify", description: "Test explainable house music rules with fictional, independently authored recordings. No Spotify content or external enrichment." };

export default function AnalysisLab() {
  return <main className="music-app"><div className="ambient" aria-hidden="true"/><header className="site-header container"><Link href="/" className="brand"><AudioLines size={26}/><span>housify<span className="brand-dot">.</span></span></Link><span className="phase-badge">INDEPENDENT FIXTURE LAB</span></header><div className="music-content container"><Link href="/dashboard" className="back-link"><ArrowLeft size={15}/> Back to your collection</Link><ClassificationReview/></div><footer className="container music-footer"><p>Fictional metadata and original placeholder artwork. No Spotify or MusicBrainz content.</p><Link href="/">Housify home</Link></footer></main>;
}
