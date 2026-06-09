# Contributing

Thanks for helping improve RunDB. This project is in active development, so the best contributions are focused, well-documented, and careful with data-model changes.

## Before You Start

Read these files first:

- `AGENTS.md`
- `CONTEXT.md`
- The relevant folder-level `context.md`
- `README.md`

If you are changing Next.js-specific behavior, also read the relevant guide in `node_modules/next/dist/docs/` because this project uses a newer Next.js version with breaking changes.

## Development Workflow

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Start the app with `npm run dev`.
4. Keep changes scoped to the feature, bug, or documentation update you are working on.
5. Run verification before opening a pull request:

```bash
npm run lint
npm run test
npm run build
```

## Architecture Rules

- Route app and component data access through `lib/data.ts` unless the code is a server-only helper or script.
- Do not import mock data or raw Supabase clients directly into ordinary app surfaces.
- Keep Supabase behavior defensive: missing keys and local demo paths should remain usable.
- When adding schema fields, update SQL, TypeScript types, mappers, RPCs, server actions, forms, tests, and documentation together.
- Prefer pure logic tests for hardware matching, report parsing, game matching, sanitization, and prediction behavior.

## Pull Requests

Use `.github/pull_request_template.md` and include:

- What changed and why
- Screenshots or recordings for UI changes
- Database migrations or SQL required
- Environment variable changes
- Verification commands and manual test notes
- Known follow-ups or incomplete migration areas

## Documentation

Update `README.md`, `CHANGELOG.md`, root `CONTEXT.md`, or the relevant folder-level `context.md` whenever a change affects setup, architecture, scripts, deployment, schema, data flow, or contributor expectations.
