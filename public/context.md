# public Context

## Purpose
`public/` stores static files served directly by Next.js. RunDB keeps this folder light; most game media comes from external URLs, Supabase Storage, or the root `public-game-covers.json` catalog.

## Read This First
- `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`: small static SVG assets from the starter/project shell.
- `../public-game-covers.json`: root-level committed cover metadata used as a static high-quality fallback for game art.
- `../lib/game-cover-catalog.ts`: imports and exposes the static cover catalog.
- `../lib/game-cover-resolver.ts`, `../lib/cover-image-url.ts`, `../lib/server/game-media.ts`: cover resolution, URL upgrade, and media storage helpers.

## Main Responsibilities
- Serve small static assets directly from the app origin.
- Avoid heavy bundled media in the repository when covers can be resolved through catalog metadata, CDN URLs, or Supabase Storage.
- Support zero-config demo behavior through the committed root cover catalog.

## Data Flow
- Public files are addressable by URL path from Next.js.
- Game cover data generally flows from `public-game-covers.json` -> `lib/game-cover-catalog.ts` -> `lib/data.ts` enrichment -> UI cover components.
- Real deployments can also use Supabase `game_media` rows and public storage URLs.
- Cover repair/reingest scripts can update media rows and, when intended, refresh the committed cover catalog.

## AI Rules
- Do not place secrets or environment-specific files in `public/`; anything here is publicly served.
- Do not add large binary assets unless the product explicitly needs committed static media.
- Prefer updating cover metadata and resolver logic over copying many game images into `public/`.
- Keep `public-game-covers.json` valid JSON and aligned with resolver expectations.
- When adding a new public asset, verify its URL path and whether Next/Image remote configuration is also needed elsewhere.

## Common Changes
- Adding a static site asset: place it in `public/`, reference it by public path, and keep file size reasonable.
- Updating game cover fallbacks: update `public-game-covers.json` and verify `lib/game-cover-catalog.ts` consumers still work.
- Fixing broken cover URLs: prefer resolver/media repair scripts before committing local image copies.
- Adding a new external image host: update `next.config.ts` remote image patterns, not this folder.

## Verification
- Run `npm run test` when cover catalog/resolver behavior changes.
- Run `npm run lint` if TypeScript cover helpers or components change.
- Run `npm run build` when Next image configuration changes.
- For public assets, run `npm run dev` and request the asset path or inspect the affected UI.

## Related Context
- `../lib/context.md`
- `../components/context.md`
- `../scripts/context.md`
- `../app/context.md`
