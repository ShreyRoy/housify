# Live playlist classification

## Run

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000, connect with Spotify, select an owned/collaborative playlist, and click **Analyze Playlist**. The existing playlist's actual entries are processed; the app does not navigate to the fictional lab.

`.env.local` must include the existing Spotify settings/session key plus:

```dotenv
MUSICBRAINZ_CONTACT=https://github.com/ShreyRoy/housify
```

The requested contact has been configured locally. Restart a previously running server after changing environment variables. No additional dependency, client secret, API key or database is needed.

## What changed

The previous `IndependentTrack` type and runtime guard admitted only fixtures; `MusicBrainzProvider` was a blocked placeholder and Analyze Playlist opened a notice. The classifier now accepts a separate real `ClassificationTrack` input, with explicit Spotify provenance, original Spotify ID and a unique row ID based on source position. FixtureProvider still rejects real inputs. Fictional tracks remain only in `/analysis-lab` and tests.

The existing playlist retrieval now preserves `spotifyTrackId`, `artistNames` and available `external_ids.isrc`, in addition to artwork/title/duration. No extra Spotify API calls or OAuth changes were necessary.

## Pipeline

1. The browser reuses the loaded playlist entries and sends minimal matching fields to the authenticated, same-origin `POST /api/analysis/track` route. Artwork, Spotify tokens and account identity never go to MusicBrainz. Source position/Spotify IDs stay in Housify and are not MusicBrainz query parameters.
2. A shared local server service tries MusicBrainz ISRC lookup when available. Otherwise, or when no verified ISRC match exists, it searches by normalized base title and primary artist. Remix/version information is preserved for candidate verification, including MusicBrainz disambiguation text. Ambiguous/wrong-version matches never contribute tags.
3. A verified recording is fetched with community genres/tags. Up to two associated releases supply weaker context. Recording tags outrank release tags; no artist reputation is used to label all of an artist's tracks.
4. The deterministic classifier returns the category, 0–100 heuristic score, matched subgenres, source URLs, match confidence, explanation, retry status, source row ID and original Spotify ID.
5. The browser displays each completed row immediately, in original source order within each category. Duplicate playlist entries stay distinct. Manual overrides do not overwrite the original evidence/score. Only forty result rows are mounted per page.

Local files, non-track entries and rows without reliable identity remain visible as Iffy House with an explanation; no external lookup is attempted. Unavailable songs with usable identifiers can still receive metadata evidence.

## Classification rules

Neutral baseline: 50. Recording evidence weight: 0.90; release: 0.55; artist: 0.12. Evidence is multiplied by match reliability and genre specificity. Maximum strength per evidence level prevents duplicate tags inflating the result; levels combine as `1 - product(1 - strength)`.

```text
score = round(clamp(50 + 50 × house - 50 × other - 15 × adjacent, 0, 100))
```

Default thresholds are 80 for Definitely House and 20 for Not House, with minimum match confidence 85. Strong recording-specific evidence is required for either decisive category; artist-only/release-only evidence cannot suffice. Conflicting strong genres force review. Missing, ambiguous and failed metadata is **IFFY_HOUSE**, never automatically Not House. Scores are not calibrated probabilities.

The vocabulary includes the requested house family and distinguishes garage house from UK garage, for example. Genre boundaries and community tags are imperfect; broad adjacent genres remain reviewable. Thresholds are configurable through the classifier API.

## Progress, caching, cancellation and retries

- Every outbound MusicBrainz request start, including search/detail/release calls and retries, is globally spaced by at least 1.1 seconds within the local Node process. The singleton survives development module reloads. Run one local server for this app; multi-process/shared-IP coordination is outside this MVP.
- Server memory caches successful HTTP and metadata lookups for up to 24 hours, bounded to 10,000 entries per cache. Failures use a 15-second metadata cache. Both reset on server restart. Deduplication preserves the complete version title and artist order; duplicate row IDs do not cause duplicate enrichment.
- Each HTTP attempt has an eight-second timeout and at most one retry. 429/503 honor Retry-After. Long cooldowns pause the playlist and display a countdown. Three consecutive failed recordings pause processing rather than hammering an unavailable service.
- Per-track server enrichment has a 65-second bound; the browser enforces a 75-second deadline. A stalled track cannot leave an infinite loading spinner. Error states preserve prior results.
- Cancel aborts the active request and stops new work. Resume processes unfinished entries; retry processes only retryable failures/partial context. Manual choices survive either action.
- Results and manual overrides are saved in this tab's sessionStorage, compacted for duplicates, and expire after one hour of inactivity. Only a digest of the current input identifies the playlist version; changed membership/order or matching metadata invalidates saved results. Refresh restores partial results but never starts another analysis. Storage failures show a warning and leave current in-memory results usable. Clear local results removes this tab's saved analysis.

Thousands of unique tracks can take hours: several rate-limited HTTP requests may be needed per recording. This is browser-driven incremental processing, not a background worker; closing the tab stops the run. Cached server metadata can speed up a later explicit resume.

## Files

- `lib/classification/musicbrainz.ts`: live HTTP transport, rate limiting, cache, retries, ISRC/search/detail matching and genre evidence.
- `lib/classification/live-service.ts`: server-only shared service and User-Agent configuration.
- `lib/classification/spotify-input.ts`, `request.ts`, `recording-key.ts`: real-entry adapter, request validation and deduplication.
- `lib/classification/live-storage.ts`: compact, validated and expiring real-analysis snapshots.
- `app/api/analysis/track/route.ts`: authenticated, origin-checked per-entry analysis API.
- `components/playlist-analysis.tsx`: actual playlist analysis and incremental manual review.
- `components/classification-result-row.tsx`: shared evidence/result row with real artwork or explicitly fictional placeholder artwork.
- Updated existing classifier/types/matching/enrichment modules; `lib/spotify/types.ts` and `normalize.ts`; playlist browser; fixture review component; CSS; `.env.example`; README.
- `tests/live-classification.test.ts`: mocked HTTP integration coverage. Existing tests retain independent fictional inputs.
- `scripts/check-musicbrainz.ts`: optional real MusicBrainz API probe using an example identifier from MusicBrainz's own documentation, not user playlist data.
- `scripts/check-analysis-route.ts`: local origin/authentication/validation smoke check using an isolated synthetic session and a missing-item input. It sends no external requests and prints no session data.

## Verify

```sh
npm test
npm run typecheck
npm run build
# Optional real MusicBrainz connectivity/provider probe:
node --experimental-transform-types scripts/check-musicbrainz.ts
# With Housify running locally:
node --experimental-transform-types scripts/check-analysis-route.ts
```

In the app, compare titles/artwork and numbered positions with the source playlist; inspect evidence/source links; change a classification; cancel/resume a large playlist; refresh and verify that no automatic run starts. Check songs without tags remain Iffy. Try Retry on a failed lookup. Confirm the separate `/analysis-lab` still says fictional and never contacts MusicBrainz.

See [API policy considerations](phase-3-policy.md). Technical functionality is not official Spotify approval. Account-level live testing must be distinguished from mocked integration tests and a public MusicBrainz probe.
