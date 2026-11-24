# Temporary Spotify metadata diagnostic

This utility only inspects endpoint responses. It does not modify classification, production screens, OAuth scopes, Spotify playlists or cached classification results. It does not contact MusicBrainz or AI services, fetch preview/audio URLs, or attempt to circumvent endpoint restrictions.

## Run with your existing Spotify session

1. Run `npm run dev` and open **http://127.0.0.1:3000** (use the callback host, not localhost).
2. Log into Housify normally if needed. No cookie/token copying or new permissions are required.
3. Open **http://127.0.0.1:3000/dev/spotify-metadata**.
4. Paste one of your Spotify playlist URLs or the ID from `/playlist/[id]`, then click **Inspect five tracks**.
5. Inspect the complete report on the page and in the development server terminal. Optionally download the redacted JSON. The utility saves no report automatically; clear the terminal or delete any download after inspection.

The utility returns 404 under `npm start`/production. Both the dev page and diagnostic API are gated. The API requires the existing session, a loopback Host and the configured same Origin. It can be removed by deleting `app/dev/spotify-metadata`, `app/api/dev/spotify-metadata`, `lib/diagnostics/spotify-metadata.ts`, and its test/documentation files.

## What is fetched

- `GET /playlists/{id}/items?limit=5&offset=...`: first five eligible song entries, scanning at most twenty pages if entries are missing/local/non-track. Duplicates remain in sample order; unique entity IDs are fetched once.
- `GET /tracks/{id}` for each sampled recording.
- `GET /artists/{id}` for all credited artist IDs from those tracks.
- `GET /albums/{id}` for their full album objects.
- `GET /audio-features/{id}` as an **explicit diagnostic access probe only**, including any denial response. This endpoint is not introduced into classification.

No `fields` filters, batch endpoints, or presentation response transforms are used. JSON responses are parsed as unknown values and preserved in full except credential redaction. Non-JSON error bodies are preserved as strings. Only the normal Authorization header is sent to Spotify; it and other request/session headers are never included in the report. The existing server-side refresh flow is reused and refreshed HttpOnly cookies are persisted. A 401 retried after refresh retains the original error body as `beforeTokenRefresh`.

## Read the report

- `rawResponses`: complete bodies, endpoint paths, HTTP statuses, request durations and Retry-After values, including failures.
- `samples`: actual sample positions/IDs and original playlist entries; never fictional replacements.
- `availability`: explicit observations for artist genres, album labels, track ISRCs and audio-feature access.
- `fieldSummary`: all returned keys and recursive paths/types, empty/null values, an explicit reference-field checklist, documented deprecations/removals, and absent keys compared with peer responses.

An empty genres array is different from an absent field or a denied artist endpoint. Zero/false are not labeled empty. “Missing” means absent from that successful response relative to the checklist/peers, not proof that Spotify removed the field. A 403 does not by itself identify missing scopes, quota-mode restrictions, or account/app access. Endpoints not reached are untested, not inaccessible.

Per-request timeout: fifteen seconds. Overall collection deadline: three minutes, with a client deadline of 195 seconds and a Cancel button. Stops on 429, unrecovered 401, a transport failure or a 100-request limit, returning partial observations. Retry-After is reported without repeatedly retrying a rate-limited endpoint.

## Documentation context (reviewed 2026-11-24)

- [Artist reference](https://developer.spotify.com/documentation/web-api/reference/get-an-artist) marks `genres`, `followers` and `popularity` deprecated. A deprecated field can still be populated.
- [February 2026 changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026) remove album `label` and other fields for updated development-mode access. Extended-quota/legacy behavior may differ.
- [March 2026 changes](https://developer.spotify.com/documentation/web-api/references/changes/march-2026) reversed removal of track/album `external_ids`. An individual recording may still lack an ISRC.
- [November 2024 access changes](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) restrict audio-feature access for newer apps, with exceptions for qualifying existing extended-mode apps. The [endpoint reference](https://developer.spotify.com/documentation/web-api/reference/get-audio-features) does not establish access for this client.

These annotations are documentation expectations; only an authenticated diagnostic run establishes what this app/account can currently observe. No architectural decision or genre inference is made from them.

## Validation

`npm test`, `npm run typecheck`, `npm run build`. Automated tests use independent synthetic metadata and exercise raw-field preservation, missing/empty distinctions, endpoint failures, rate-limit stopping, sampling/deduplication and credential redaction. They do not establish live access for the user's account.
