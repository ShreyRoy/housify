# Housify

A dark, responsive landing page for a future Spotify-connected house music discovery app. **Phase 1 only**: no authentication, Spotify API calls, classification, or playlist creation.

## Run locally

Requires Node.js 20.9 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:3000. For production: `npm run build` then `npm start`. Run `npm run typecheck` for TypeScript validation.

## Architecture

- `app/layout.tsx`: root layout and metadata. `app/page.tsx`: server-rendered landing page.
- `app/globals.css`: dark design tokens, Tailwind CSS v4 theme mapping, responsive layouts, focus states, reduced-motion support.
- `components/ui.tsx`: shared button and eyebrow primitives.
- `components/spotify-connect.tsx`: client-side placeholder CTA with an explicit coming-soon notice.
- `components/swipe-preview.tsx`: isolated client component for mock include/skip, pointer swiping, undo, completion, and reset. State is in memory and resets on reload.
- `lib/mock-tracks.ts`: clearly fictional demo data. Genre labels are hand-authored illustrations, not classification results.

The landing page describes the **planned** three-bucket classification and review flow. Only the local mock card demo is implemented. No environment variables or credentials are needed. No track audio is available.

## Dependencies

- Next.js App Router, React, TypeScript: application foundation and typed components.
- Tailwind CSS v4 with its PostCSS plugin: CSS processing and reusable theme tokens.
- Lucide React: consistent SVG interface icons.

CSS handles the small hover and drag transitions, so no animation library is needed in this phase. Album artwork is original CSS geometry; no external image or font requests are required.

The production build uses Next.js’s Webpack option because Turbopack’s CSS worker requires a local port that is blocked in the development sandbox. The app remains a standard Next.js App Router application.

## Future integration boundary

Spotify OAuth, playlist reads, house classification, and playlist writes remain future work. Keep secrets server-side, separate Spotify access and classification services from presentation components, and introduce a dedicated final review screen before enabling any write. Playlist creation must require an explicit confirmation; the current app performs no network integration or playlist writes.
