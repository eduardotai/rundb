# Phase 5: Basic Monitoring Setup Guidance
**Sentry + Supabase Usage Alerts for Real-Data Flows**

**Alignment to approved Master Plan**: Real-data paths in `lib/data.ts` (all `*Async` functions + `addUserReport` / `upvoteReport`) have explicit try/catch with console.error + fallback to mock. Production requires proper error tracking + usage monitoring to catch:
- Supabase outages / RLS misconfigs (triggers fallback spam)
- Query performance (indexes exist but monitor slow reports queries)
- Abuse / rate limit hits
- Ingestion / Storage issues
- Auth / moderation failures
- Client vs server errors in Server Actions (`app/actions/reports.ts`)

Current state (pre-Phase 5): No Sentry. No custom alerts. Relies on Supabase dashboard + browser console. `next.config.ts`, middleware, and data adapter are ready for instrumentation.

## 1. Sentry Setup (Error Tracking & Performance)

### Install & Configure (Next.js 16 / App Router)
```bash
# In project root
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

Follow the wizard (it updates `next.config.ts`, adds `sentry.server.config.ts`, `sentry.client.config.ts`, `instrumentation.ts`).

**Key files after wizard (align with our structure):**

- `sentry.client.config.ts` (client errors in React components, hooks like `useGames`, ReportCard, SubmitReportDialog)
- `sentry.server.config.ts` (Server Actions, data.ts server imports, middleware)
- `instrumentation.ts` (edge + node for tracing)
- Update `next.config.ts` (wizard adds `withSentryConfig` wrapper — keep our existing image config + remotePatterns):

```ts
// next.config.ts (example merge)
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { /* our existing Phase 1 config for supabase.co + igdb + steam */ },
  // ...
};

export default withSentryConfig(nextConfig, {
  org: "your-org",
  project: "rundb",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  reactComponentAnnotation: { enabled: true },
  tunnelRoute: "/monitoring",
  disableLogger: true,
  automaticVercelMonitors: true,
});
```

### Instrument Real-Data Flows (Critical)
Wrap / tag errors in the data adapter and actions (production-safe, no behavior change):

**In `lib/data.ts`** (example additions — add after imports):
```ts
import * as Sentry from '@sentry/nextjs';

// In each catch block, e.g. getReportsForGameAsync:
} catch (err: any) {
  console.error('[data] ...', err);
  Sentry.captureException(err, {
    tags: { flow: 'getReportsForGameAsync', realData: USE_REAL },
    extra: { gameId, filters }
  });
  return mock...
}
```

Do the same for:
- All `get*Async`, `compute*Async`, `predict*Async`
- `addUserReport` / `upvoteReport` (tag 'submit' / 'upvote')
- `useGames` hook
- Server Action errors in `app/actions/reports.ts` (use `Sentry.captureException` in catch of submitReportAction, moderateReportAction, etc. Include user context if safe).

**In Server Actions** (`app/actions/reports.ts`):
```ts
import * as Sentry from '@sentry/nextjs';

} catch (e) {
  Sentry.captureException(e, { tags: { action: 'submitReportAction' } });
  throw ...
}
```

### UI / Component Best Practices
- Add Sentry ErrorBoundary around high-value sections (game detail, submit dialog, admin queue).
- Use `Sentry.startSpan` for custom perf in expensive pure helpers if needed (e.g. predictForUserRigFromReports on large report sets).
- Set user context on auth: `Sentry.setUser({ id: user.id, role: profile.role })` in auth flows or layout.
- Release tracking: pass `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` or similar.

### Sampling & Privacy (Production)
- TracesSampleRate: 0.1–0.2 (or env-driven)
- Replays: session sample 0.1, error sample 1.0 (mask PII in reports/notes)
- Never send full report text / hardware strings if sensitive; use beforeSend hooks.
- DSN only in prod env vars (public DSN is ok for client).

### Alerts in Sentry
- Create alerts for:
  - Error rate > 1% on `data` or `reports` transactions
  - New errors in `get*Async` or `submitReportAction`
  - Performance regression on `/games/[slug]` (p95 > 800ms)
  - Fallback rate (custom metric or error tagged "falling back to mock")

## 2. Supabase Usage Alerts & Monitoring

Supabase provides built-in usage dashboards + alerts (no code change needed for basic).

### Where to Configure (Supabase Dashboard)
1. Go to your project → **Usage** (left nav) or **Settings > Usage**.
2. Key metrics to watch for RunDB real-data:
   - **Database**: Size (GB), Compute hours, Row counts (reports will grow fastest).
   - **Storage**: `game-media` bucket egress + size (images from ingestion + future user uploads).
   - **Auth**: Monthly Active Users (MAU) — anon + OAuth signups.
   - **API / Edge Functions**: Requests count, egress, errors (if we add any RPCs or future functions).
   - **Realtime**: (not heavily used yet — monitor if reports polling changes to sub).

### Recommended Alert Thresholds (Phase 5 MVP)
Set email + Slack (or webhook) alerts via Supabase **Alerts** section (or integrate with Sentry/PagerDuty later):

- Database size: Alert at 60% of plan limit (reports table + indexes grow with community).
- Storage: `game-media` > 5GB or egress > 50GB/mo (ingestion + popular covers).
- MAU: 70% of plan (early sign of success/abuse).
- API requests: Spike > 3x baseline (possible scraping or bug in client polling).
- Error rate in Supabase logs (auth failures, RLS denied, rate limit errors from our anti-abuse).
- Slow queries: Use Supabase Query Performance / Logs for `reports` table scans (leverage our indexes).

**Pro tips for our schema**:
- Monitor the `reports` table growth (status='approved' index is partial).
- Watch `game_media` + `report_images` for storage bloat.
- `profiles` + `user_rigs` for auth + rig data.
- Use Supabase Logs Explorer: filter `error` level on `reports` or `auth`.
- Enable "Database Webhooks" or "Edge Function Logs" only if we add future serverless logic.

### Custom / Enhanced Monitoring (Lightweight, No Extra Cost)
- In `lib/data.ts` real paths: after successful query, optionally log timings or count (send to Sentry as breadcrumb or custom metric).
- Simple health endpoint (future): `/api/health` that calls `getAllGames()` (real) + `supabase.from('reports').select('count')` and returns status. Sentry can uptime monitor it.
- Fallback detector: count "[data] ... falling back to mock" occurrences (treat as warning signal of DB/RLS issue).

### Integration Between Sentry + Supabase
- Sentry can ingest Supabase logs via webhooks or manual forwarding (advanced).
- Tag Sentry events with Supabase project ref for correlation.
- Use Supabase as source of truth for usage; Sentry for application errors + traces that hit the DB.

## 3. Hosting / Deployment Monitoring
- Vercel (or equivalent): Function logs, edge logs, deployment previews for flag changes.
- Set alerts for build failures, 5xx rates, slow TTFB on game pages.
- Feature flag change = trigger canary deploy + increased monitoring window.

## 4. Runbook / On-Call (Phase 5)
- High fallback rate → Check Supabase status + RLS + env keys + recent schema changes. Rollback flag first (see ROLLBACK_PLAN.md).
- Submission failures → Inspect rate limit / dup logic + profile role.
- Storage 404s on covers → Re-run ingestion or fix bucket policy.
- Moderation queue not seeing reports → Verify moderator RLS policy + profile.role.
- Document pager rotation + escalation in team wiki.

## 5. Future Enhancements (Post Phase 5)
- Full distributed tracing across Server Action → Supabase.
- Custom dashboards (Grafana + Supabase exporter or Sentry + custom).
- Anomaly detection on report submission volume / FPS distributions.
- Synthetic monitors hitting key real-data flows (can reuse the E2E harness).

**Verification Steps**:
1. After Sentry install, trigger a deliberate error in a real-data path (e.g. bad slug) → appears in Sentry with correct tags.
2. In Supabase, temporarily exceed a soft limit or watch Usage page during load test.
3. Enable flag in staging → confirm no uncaught errors, usage graphs move.

**Do not flip to prod until Sentry + at least 3 Supabase alerts are live and tested.**

**Last updated:** 2026-05-26 (PR 6 / Agent 6 — references updated E2E with image/media assertions + `VERIFICATION_SWARM_PROMPTS.md` 6-agent swarm). Monitor `game_media` + report_images storage as noted; synthetic monitors can now reuse extended E2E harness image checks.

This guidance keeps overhead low while giving visibility into the real-data paths introduced in Phases 1–4.
