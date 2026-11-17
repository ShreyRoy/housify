# Housify

**Phase 3:** Analyze Playlist now processes the selected playlist's actual tracks through live MusicBrainz metadata matching and the deterministic house classifier. Fictional fixtures remain only in `/analysis-lab` and tests. See [the live workflow guide](docs/classification.md) and [unresolved API policy considerations](docs/phase-3-policy.md). No swiping, audio analysis, playlist writes or new dependencies were added.

A personal Spotify playlist browser and foundation for a future house music curator. Phase 2 adds PKCE authentication, persistent sessions, playlist browsing and ordered track lists. The Phase 1 landing page and fictional card demo remain intact. Live metadata classification is implemented; real swipe review, playback, and playlist writes are not.

## Run locally

Use Node.js 22.16 or newer (tests use Node's experimental TypeScript support). Your ignored `.env.local` needs these server-only settings:

```dotenv
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback
SESSION_SECRET=your_generated_32_byte_base64url_key
MUSICBRAINZ_CONTACT=https://github.com/ShreyRoy/housify
```

Setup generated `SESSION_SECRET` in the existing `.env.local` if it was missing. It is a private application encryption key, not a Spotify client secret. Keep it stable across restarts and never prefix it with `NEXT_PUBLIC_`. To generate one for another installation:

```sh
node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'
```

For a fresh checkout, copy `.env.example` to `.env.local` and fill it in. Do not overwrite an existing `.env.local` or commit its contents. Register the exact redirect URI in the [Spotify developer dashboard](https://developer.spotify.com/dashboard). Development-mode app owners need Premium, and test accounts must be allowed in the app's user-management settings; see [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. The login route normalizes to the configured callback origin because localhost and 127.0.0.1 have different cookies. For production locally: `npm run build` then `npm start -- --hostname 127.0.0.1`.

## Test Spotify login and browsing

1. Click **Connect with Spotify** and approve read-only private/collaborative playlist access. Successful authorization redirects to `/dashboard`, which shows your display name and playlists.
2. Compare your collection with Spotify, including playlists after the first 50. All pages are fetched sequentially. Spotify counts are labeled items because playlists can contain episodes. Missing counts say unavailable rather than zero.
3. Open a playlist you own or collaborate on. Compare entries after position 50, duplicate songs and their ordering. Missing, local, unavailable and non-track items retain their original numbered slots.
4. Try a followed playlist you do not own. The UI explains development-mode item access restrictions and provides a Spotify link. Spotify can also deny access for accounts outside the allowlist or missing scopes.
5. Reload the dashboard to check session persistence. Leave it signed in past access-token expiry, then reload: the server refreshes before the next Spotify read and persists the updated cookie. Refresh is request-driven, not a timer. A rejected refresh asks you to reconnect.
6. Log out, then visit `/dashboard` to confirm sign-in is required. This clears Housify's session; it does not log you out of Spotify or revoke the grant. Use **Manage Spotify access** to revoke it.
7. Cancel Spotify consent to test graceful denial. Open `/api/auth/callback?code=fake&state=fake` to test state rejection; no code is exchanged.

```sh
npm test
npm run typecheck
npm run build
# In a second terminal while the app runs on 127.0.0.1:3000:
npm run test:auth
```

Unit tests mock HTTP responses for pagination, 401/403/429, token rotation, encryption, PKCE and missing metadata. The local auth smoke test exercises actual routes, cookie flags, state rejection, denial, protected routes and logout origin checks. It does not follow the Spotify redirect or sign into a real account. Node may print an experimental TypeScript warning.

## Architecture

Browser components call same-origin Housify API routes; only the server contacts Spotify. Tokens never appear in client props, JSON responses, browser storage or application logs.

| Module | Responsibility |
| --- | --- |
| `app/api/auth/login`, `callback`, `logout` | OAuth redirects, state validation, code exchange and POST logout |
| `lib/spotify/config.ts`, `crypto.ts` | Configuration validation, PKCE, constant-time state comparison and AES-256-GCM encryption |
| `lib/spotify/session.ts`, `require-session.ts` | Encrypted persistent cookies and protected-page checks |
| `lib/spotify/oauth.ts`, `token.ts` | Token exchange, refresh, rotation and fixed session expiry |
| `lib/spotify/client.ts`, `errors.ts`, `api.ts` | No-cache GET requests, bounded 401 retry, pagination and safe responses with refreshed cookies |
| `lib/spotify/types.ts`, `normalize.ts` | Spotify types and minimal UI display models |
| `app/api/spotify/library`, `playlist/[id]` | Read-only profile, playlist and track responses |
| `app/dashboard`, `app/playlist/[id]` | Protected pages and loading shells |
| `components/music-*`, `playlist-card.tsx`, `track-row.tsx` | Responsive browsing, skeletons, error/retry states and artwork |
| `components/spotify-connect.tsx`, `auth-notice.tsx` | Landing-page login and safe sign-in error notices |
| `app/globals.css`, `components/ui.tsx` | Shared dark tokens, primitives, focus and reduced-motion styles |
| `components/swipe-preview.tsx`, `lib/mock-tracks.ts` | Unchanged fictional Phase 1 demo |

### How PKCE and refresh work

Login creates a random verifier and state. Spotify receives the verifier's SHA-256 hash as a challenge; the verifier and state remain in an encrypted HttpOnly cookie for ten minutes. The callback checks state before exchanging the returned code with the original verifier. That proves the code exchange belongs to the browser that initiated login, without a client secret. The transaction cookie is then discarded.

The token pair is stored in an authenticated-encrypted, host-only, HttpOnly, SameSite=Lax cookie with a fixed 30-day lifetime. The cookie survives page reloads and server restarts with the same key. Cookies are Secure on HTTPS; the registered HTTP loopback URL is the local-development exception. A deployment must use HTTPS and update both the callback registration and environment variable.

Before each Spotify read, tokens within 60 seconds of expiry are refreshed. A Spotify 401 triggers one refresh and one retry. Rotated refresh tokens are persisted; if Spotify omits a new refresh token, the old one is retained. Refresh does not extend the original 30-day session. Concurrent refreshes are coalesced within one server process.

There is no database. For future multi-instance hosting, use a shared session store with refresh locking and revocation. Stateless logout clears the browser cookie but cannot revoke a copied cookie before expiry. Changing the session key invalidates all sessions.

### API behavior and attribution

- Uses `GET /me`, `GET /me/playlists`, `GET /playlists/{id}` and the February 2026 `GET /playlists/{id}/items` endpoint with the `item` field. Legacy `tracks`/`track` response fields are tolerated for extended-quota compatibility; the deprecated `/tracks` endpoint is never called.
- Requests only `playlist-read-private` and `playlist-read-collaborative`, with no modification scopes. Display names use public profile data.
- 403 errors explain ownership/collaboration and app-access restrictions. 429 responses preserve `Retry-After`; the retry button stays disabled until that period passes. Failed pagination shows an error instead of a partial list presented as complete.
- Logout requires POST with a matching Origin header. API responses use `Cache-Control: private, no-store`; OAuth redirects suppress referrer information. Pagination links are validated before forwarding bearer tokens.
- Spotify's official white full logo is included unmodified in `public/spotify-logo.svg`. Content links back to Spotify. Artwork uses `object-fit: contain`, with no cropping, overlays, filters or rounded masks.

Official references: [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [token refresh](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens), [February 2026 migration](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [playlist items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items), [current-user playlists](https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists), [attribution and design](https://developer.spotify.com/documentation/design).

## Dependencies

- Next.js App Router, React, TypeScript: application foundation and typed components.
- Tailwind CSS v4 with its PostCSS plugin: CSS processing and reusable theme tokens.
- Lucide React: consistent SVG interface icons.

Phase 2 adds only `server-only`, which prevents token/configuration modules from being imported into browser components. Node's built-in cryptography, fetch and test runner handle the rest. No OAuth SDK, database or animation library is needed. Real artwork is loaded directly from Spotify's image URLs; fictional landing-page artwork remains CSS geometry.

The production build uses Next.js’s Webpack option because Turbopack’s CSS worker requires a local port that is blocked in the development sandbox. The app remains a standard Next.js App Router application.

## Future integration boundary

Real swipe review remains future work. No playlist writes are implemented. A future playlist-creation flow must include a final review and explicit confirmation.
