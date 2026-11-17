import { NextRequest, NextResponse } from "next/server";
import { readSession, privateResponse } from "@/lib/spotify/session";
import { spotifyConfig } from "@/lib/spotify/config";
import { liveEnrichment } from "@/lib/classification/live-service";
import { parseAnalysisRequest } from "@/lib/classification/request";
import { classify } from "@/lib/classification/classifier";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  try {
    const config = spotifyConfig();
    if (request.headers.get("origin") !== config.origin) return privateResponse(NextResponse.json({ message: "Invalid request origin." }, { status: 403 }));
    if (!await readSession()) return privateResponse(NextResponse.json({ message: "Your session has ended. Reconnect with Spotify before continuing." }, { status: 401 }));
    if (Number(request.headers.get("content-length")) > 10000) return privateResponse(NextResponse.json({ message: "Analysis input is too large." }, { status: 413 }));
    const raw = await request.text();
    if (raw.length > 10000) return privateResponse(NextResponse.json({ message: "Analysis input is too large." }, { status: 413 }));
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return privateResponse(NextResponse.json({ message: "Invalid analysis request." }, { status: 400 })); }
    const parsed = parseAnalysisRequest(body);
    if (!parsed) return privateResponse(NextResponse.json({ message: "The track’s matching metadata is invalid. Reload the playlist." }, { status: 400 }));
    const service = liveEnrichment();
    const metadata = await service.lookup(parsed.track, request.signal, parsed.retry);
    const response = NextResponse.json(classify(parsed.track, metadata));
    if (metadata.retryAfter) response.headers.set("Retry-After", String(metadata.retryAfter));
    return privateResponse(response);
  } catch (error) {
    if (request.signal.aborted) return privateResponse(NextResponse.json({ message: "Analysis cancelled." }, { status: 499 }));
    const message = error instanceof Error && error.message.includes("MUSICBRAINZ_CONTACT") ? error.message : "The metadata lookup could not complete. Completed results are preserved; retry or resume when ready.";
    return privateResponse(NextResponse.json({ message }, { status: 503 }));
  }
}
