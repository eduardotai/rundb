# Standalone PR & Services Hub — Design Document

**Date:** 2026-06-03  
**Status:** Architecture approved by user. Full spec ready for user review.  
**Author:** Grok (following brainstorming process)  
**Project:** Personal command hub for GitHub PRs (approve, disapprove, AI-powered conflict resolution with main) + general services hub (Vercel, Notion, Canva, cross-service AI brief).  
**Scope:** Completely standalone Next.js application (sibling folder to existing `grokbuild/` RunDB project).

---

## 1. Executive Summary

A focused, personal web app that acts as a "command center" for the user (eduardotai). Primary purpose is efficient GitHub PR management with built-in AI assistance for merge conflicts. Secondary purpose is a lightweight general hub for other frequently used services.

Key differentiator: **High-autonomy AI conflict resolver** that can automatically detect conflicts with `main`, propose (and on high confidence, auto-apply) resolutions, then push the fix back to the PR branch.

The app is deliberately kept separate from the RunDB codebase for clarity and to avoid polluting the existing project.

---

## 2. Goals & Non-Goals

### Goals
- Fast, scannable dashboard for open PRs across the user's repos (focus on ones needing attention: conflicts, reviews requested, stale).
- One-click or low-friction actions: Approve, Request Changes, Merge, View Diff.
- **AI Conflict Resolver (high autonomy)**: When a PR conflicts with `main`, the system can autonomously resolve it using Grok/xAI and apply the fix if confidence is high. User is notified; low-confidence cases require explicit review.
- General hub tiles for quick visibility into Vercel deploys, Notion tasks, Canva designs, plus an "AI Daily Brief" that aggregates status across services.
- Clean, consistent UI that feels familiar to the user (same design language as RunDB: dark navy, cyan accents, shadcn/ui components).
- Secure handling of tokens (GitHub OAuth with repo scope required for writes).
- Audit trail for all AI-driven actions (what was resolved, confidence, prompt summary, outcome).
- Easy to run locally and deploy (Vercel).

### Non-Goals (for v1)
- Multi-user / team support.
- Full code review UI (beyond approve/request-changes).
- Deep editing of Notion pages or Canva designs inside the hub (read + status + quick actions only).
- Advanced CI log viewing or log streaming.
- Offline mode.
- Self-hosted backend (Next.js server actions + API routes are sufficient).

---

## 3. High-Level Architecture (Approved Approach 1)

**Familiar Stack Standalone**

- Single Next.js 16 App Router project (`github-pr-hub/` sibling folder).
- Same tech as RunDB for rapid development and mental model reuse:
  - TypeScript
  - Tailwind + shadcn/ui + Radix
  - Server Actions for all mutations and secure external calls
  - React Query (or Server Components + revalidate) for data
- All sensitive operations (GitHub writes, AI calls, token handling) **strictly server-side**.
- Persistence: Start with localStorage + in-memory for v1 prototype speed. Add lightweight persistence (Vercel KV, Supabase, or a private GitHub repo for audit logs) in follow-up iteration. Tokens stored encrypted (e.g. via `iron-session` or similar + env secret).
- External services called only from server:
  - GitHub (Octokit + Git Data API for precise conflict resolution commits)
  - xAI Grok API (for conflict resolution + AI Brief generation)
  - Vercel, Notion, Canva SDKs/APIs (read-focused + limited actions)

**Architecture Diagram (text version of approved visual)**

```
Browser (Hub UI)
  ├── Dashboard (tiles + PR queue)
  ├── PR Detail + Actions
  ├── AI Conflict Resolver panel
  └── Module pages (Vercel / Notion / Canva / Brief)
         ↓ (Server Actions / Route Handlers)
Next.js Server
  ├── GitHub OAuth + token management
  ├── GitHub client (Octokit)
  ├── AI Resolver (fetch conflicting files → Grok → parse → commit via Git Data API if high conf)
  ├── Integration clients
  └── AI Brief aggregator
         ↓
External: GitHub • xAI Grok • Vercel • Notion • Canva
```

---

## 4. Tech Stack & Tooling

- **Framework**: Next.js 16 (App Router), React 19
- **Language**: TypeScript (strict)
- **Styling**: Tailwind CSS 4 + shadcn/ui + Radix primitives (match RunDB)
- **Data fetching**: Server Components + Server Actions + React Query where interactive
- **Auth**: GitHub OAuth (via `next-auth` or custom route + `iron-session` for simplicity)
- **GitHub client**: `@octokit/rest` + `@octokit/plugin-create-or-update-text-file` or raw Git Data API for conflict resolution
- **AI**: Direct fetch to xAI Grok API (or official SDK when available). Structured output preferred (JSON mode).
- **Other integrations**:
  - Vercel: `@vercel/sdk` or REST
  - Notion: official `@notionhq/client`
  - Canva: Canva Connect API (or public export endpoints)
- **Dev / Deploy**: Vercel (natural fit)
- **Env / Secrets**: `.env.local` (never commit real tokens). Recommend user creates GitHub OAuth App + xAI API key.
- **Linting / Formatting**: Same as RunDB (ESLint, Prettier, TypeScript)
- **Optional later**: Add Supabase or Vercel KV for persistent audit log + user preferences.

---

## 5. Data Model (v1)

Minimal, mostly derived from external services + local state.

```ts
// Core entities (in-memory or simple storage for v1)
type UserConnection = {
  service: 'github' | 'vercel' | 'notion' | 'canva';
  accessToken: string; // encrypted at rest
  refreshToken?: string;
  scopes: string[];
  connectedAt: string;
};

type PR = {
  id: number;
  repo: string;          // "owner/repo"
  number: number;
  title: string;
  author: string;
  state: 'open' | 'closed';
  headRef: string;
  baseRef: string;       // usually "main"
  hasConflictsWithMain: boolean;
  aiResolution?: AIResolution;
  lastUpdated: string;
};

type AIResolution = {
  prId: string;
  confidence: number;    // 0-100
  summary: string;       // what the AI changed and why
  resolvedFiles: string[];
  applied: boolean;      // whether we auto-pushed
  appliedAt?: string;
  auditLog: string;      // prompt hash + response excerpt
};

type ModuleStatus = {
  service: string;
  summary: string;
  itemsNeedingAttention: number;
  lastChecked: string;
};

type AuditEvent = {
  id: string;
  timestamp: string;
  type: 'ai_resolution' | 'pr_approve' | 'pr_merge' | 'module_action';
  details: any;
};
```

For v1 we can store `AuditEvent[]` and user preferences in `localStorage` + a server-side encrypted file or Vercel KV. Full DB can be added later without changing the architecture.

---

## 6. Core Features & Flows

### 6.1 GitHub PR Hub (Primary)

- **Authentication**: GitHub OAuth (user clicks "Connect GitHub" → repo scope). Token stored server-side only.
- **PR List**: Fetches open PRs from user's repos (or a curated list of important ones). Shows:
  - Title, repo, author, age
  - Conflict status with `main`
  - AI resolution status (if any)
  - Quick actions
- **PR Detail Page**:
  - Diff view (or link to GitHub)
  - Status badges (conflicts? reviews? checks?)
  - Action buttons: Approve, Request Changes, Merge (with method choice)
  - Prominent "Resolve Conflicts with AI" section (if `hasConflictsWithMain`)
- **Conflict Resolution Flow (High-Autonomy)**:
  1. User or cron/background detects conflict (or user clicks "Resolve with AI").
  2. Server fetches base (main), ours (PR head), theirs (merge base or current).
  3. Sends rich prompt to Grok including: PR description, commit messages, relevant code, user's past resolutions if stored, repo guidelines.
  4. Grok returns structured resolution (per-file patches or full resolved content) + confidence + explanation.
  5. If confidence ≥ threshold (e.g. 80%) **and** repo not in "always-review" list:
     - Server creates new commit on the PR's head branch using Git Data API (blobs → tree → commit).
     - Marks PR as resolved, adds audit event.
     - User receives toast / notification.
  6. If low confidence or always-review: show nice diff of proposed resolution in UI. User can edit, accept, or reject.
- **Safety Rails** (critical):
  - Never auto-apply on protected branches without extra confirmation.
  - Per-repo "never auto" setting.
  - Full audit log visible in UI (what prompt was used, what was changed, SHA of the resolution commit).
  - "Undo" link that opens GitHub revert (or we can implement revert commit).
  - Rate limiting + manual override always available.

### 6.2 General Hub Modules

**Vercel**
- List projects + latest deploy status
- Quick actions: "Promote to Production", "View Logs", "Open Preview"
- AI brief contribution: "2 deploys failed today"

**Notion**
- List of key databases (tasks, roadmap, etc.)
- Show items assigned to user or due soon
- Quick "Mark done" or create task from a resolved PR

**Canva**
- Recent designs / brand kits
- Thumbnails + "Open in Canva" deep links
- Status for any designs used in recent PRs (if we store metadata)

**AI Daily Brief** (cross-service)
- Aggregates:
  - PRs needing attention
  - Failed deploys
  - Overdue Notion tasks
  - New Canva designs
  - Recent AI resolutions performed
- Generated on demand or on a schedule using Grok with context from the other modules.

All modules are **read-heavy** with limited write actions. This keeps scope manageable while delivering high value.

---

## 7. UI & Navigation

- **Layout**: Sticky header with user avatar + "Connected services" pills. Sidebar with:
  - PR Hub (with badge for "needs resolution")
  - Vercel
  - Notion
  - Canva
  - AI Brief (always visible or top)
- **Dashboard** (home): Grid of module tiles + "PRs needing you" list (prioritized by conflicts + AI-resolved ones).
- **Consistent patterns** from RunDB:
  - Dense but scannable cards
  - Cyan primary actions
  - Performance/severity badges adapted to "conflict severity" or "review status"
  - Toasts via sonner for AI actions and results

Responsive but desktop-first (user's primary use case).

---

## 8. Security & Privacy

- **GitHub token**: `repo` scope is powerful. Store encrypted at rest. Never log raw tokens. Use short-lived access where possible.
- **AI auto-apply**: Only on user's own PRs/repos by default. Explicit allow-list for repos where auto is trusted.
- **Audit everything**: Every AI resolution creates an immutable event with prompt summary, model version, confidence, before/after SHAs.
- **User control**: Global "AI Auto-Apply" toggle + per-repo overrides. "Review all AI suggestions before apply" mode.
- **Error transparency**: If AI fails or push fails, surface exact error + suggestion to user (never silent failure on auto path).
- **Secrets**: All API keys (xAI, Vercel, etc.) in server environment only.

---

## 9. Development & Deployment

- Local dev: `npm run dev`
- Required env vars (documented in `.env.example`):
  - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
  - `XAI_API_KEY`
  - Optional: Vercel/Notion/Canva tokens for full module experience
- Deploy: Vercel (one-click from GitHub). The app can live on a subdomain or separate repo.
- For the separated nature: The folder can be its own Git repo or a monorepo package. Recommend separate repo for clean history.

---

## 10. Open Questions / Future Work (post v1)

- Persistence layer (Supabase vs Vercel KV vs private "hub-config" repo)
- Background jobs / webhooks for real-time PR updates (GitHub webhooks)
- Better conflict detection (currently relies on GitHub's "conflicts with base" flag + our own diff check)
- Storing user's "resolution style" so future AI prompts are personalized
- Mobile companion or PWA
- Cost tracking for Grok API usage on heavy auto-resolution days

---

## 11. Next Steps (after this spec is approved)

1. Create the real `github-pr-hub/` folder with the structure from the approved preview.
2. Set up basic Next.js + shadcn + GitHub OAuth skeleton.
3. Implement GitHub PR listing + detail.
4. Build the AI conflict resolver (first manual review mode, then add auto-apply with safety).
5. Add the four general modules (start read-only, then limited actions).
6. Polish UI + add audit log viewer.
7. Deploy + document setup for the user.

This design is intentionally scoped so a useful first version can be delivered quickly while leaving clear extension points.

---

**User Review Request**

Please review this document. Reply with:
- "Approved — proceed to implementation plan" (or similar)
- Or specific changes / questions / concerns.

Once you approve, we will move to the `writing-plans` skill to create a detailed, actionable implementation plan (with tasks, files to touch, order of work, etc.), then execute.