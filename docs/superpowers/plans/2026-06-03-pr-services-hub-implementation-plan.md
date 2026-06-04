# PR & Services Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Next.js web application (as a sibling folder `pr-hub` next to the existing grokbuild workspace) that serves as a personal hub for listing, reviewing, approving, and merging GitHub PRs, with high-autonomy AI-powered automatic resolution of conflicts against the `main` branch, plus a general dashboard for quick visibility into Vercel projects, Notion tasks, Canva designs, and an aggregated AI Daily Brief.

**Architecture:** Single Next.js 16 App Router application using Server Actions for all secure external calls (GitHub via Octokit, xAI Grok for AI resolver, other service SDKs). GitHub OAuth for authentication (repo scope). High-autonomy AI flow: detect conflicts, call Grok with rich context, auto-apply high-confidence resolutions via Git Data API commits, with full audit logging and user overrides. UI uses shadcn/ui components for consistency with RunDB patterns (dense cards, cyan accents, toasts). General modules are primarily read-only status tiles with limited quick actions. Persistence starts with localStorage for UI state + secure server-side session storage for tokens; audit logs in local file or simple KV for v1.

**Tech Stack:** Next.js 16 (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui + Radix, next-auth (GitHub provider), @octokit/rest, xAI Grok API (direct fetch with structured output), lucide-react, sonner (toasts), date-fns. Deploy target: Vercel. No Supabase in v1 to keep truly standalone.

---

## File Structure Overview (Locked for this plan)

The new project will live at `C:\Users\taken\pr-hub` (sibling to grokbuild).

Key files to create/modify (decomposed by responsibility):

- `pr-hub/app/layout.tsx` - Root layout with header, providers, Toaster
- `pr-hub/app/page.tsx` - Main dashboard (PR queue + module tiles + AI Brief)
- `pr-hub/app/prs/page.tsx` - Full PR list with filters
- `pr-hub/app/prs/[owner]/[repo]/[number]/page.tsx` - PR detail with actions and AI resolver
- `pr-hub/app/modules/vercel/page.tsx`, notion, canva, brief - Module pages
- `pr-hub/app/auth/signin/page.tsx` and callback route for GitHub OAuth
- `pr-hub/components/pr-card.tsx` - Reusable dense PR card (inspired by RunDB ReportCard)
- `pr-hub/components/module-tile.tsx` - Tile for general hub modules
- `pr-hub/components/ai-resolver.tsx` - The conflict resolver UI panel
- `pr-hub/lib/github.ts` - Octokit client + PR fetching, review, merge, conflict detection, commit creation
- `pr-hub/lib/ai.ts` - Grok API caller + prompt builder for conflict resolution + brief generation
- `pr-hub/lib/auth.ts` - next-auth config + session helpers + token storage
- `pr-hub/lib/integrations/vercel.ts`, notion.ts, canva.ts - Service clients
- `pr-hub/lib/audit.ts` - Simple audit logger for AI actions
- `pr-hub/app/actions/github.ts` - Server actions for approve, merge, resolve
- `pr-hub/app/actions/ai-resolve.ts` - The core high-autonomy resolver action
- `pr-hub/types.ts` - All shared types (PR, AIResolution, etc.)
- `pr-hub/.env.example` - All required env vars documented
- `pr-hub/package.json` - With added deps

No large files. Each lib file owns one integration or concern.

---

### Task 1: Initialize the standalone Next.js project (sibling folder)

**Files:**
- Create: Entire `pr-hub/` project (via CLI)
- Create: `pr-hub/.env.example`
- Create: `pr-hub/.gitignore` (standard Next.js)

- [ ] **Step 1.1: Run project creation command from parent directory**

Run (in PowerShell, from C:\Users\taken):

```powershell
cd ..
npx create-next-app@latest pr-hub --yes --tailwind --eslint --yes
```

Expected: New folder `pr-hub` created with standard Next.js files. No errors.

- [ ] **Step 1.2: Enter the new project and verify**

```powershell
cd pr-hub
npm run dev
```

Expected: Dev server starts on http://localhost:3000 (or next available). You see the default Next.js welcome page. Kill the server after verification (Ctrl+C).

- [ ] **Step 1.3: Create .env.example with all secrets we will need**

Use the write tool (or cat via terminal) to create `pr-hub/.env.example` with this exact content:

```env
# GitHub OAuth App (create at https://github.com/settings/applications/new)
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here

# xAI Grok API (get at https://console.x.ai/)
XAI_API_KEY=your_xai_key_here

# Optional for full module experience (user can provide later)
VERCEL_TOKEN=
NOTION_TOKEN=
CANVA_ACCESS_TOKEN=
```

- [ ] **Step 1.4: Update .gitignore if needed (standard Next.js is fine)**

No changes usually needed. Confirm `.env*.local` is ignored.

- [ ] **Step 1.5: Commit the initialization**

```bash
git init
git add .
git commit -m "chore: init Next.js 16 standalone pr-hub project"
```

---

### Task 2: Install dependencies and initialize shadcn/ui

**Files:**
- Modify: `pr-hub/package.json`
- Create: `pr-hub/components.json` (after shadcn init)
- Create many shadcn component files in `pr-hub/components/ui/`

- [ ] **Step 2.1: Install core additional packages**

In `pr-hub/`:

```bash
npm install next-auth@4 @octokit/rest lucide-react sonner date-fns framer-motion
npm install -D @types/node
```

(We use next-auth v4 for stability with GitHub provider.)

- [ ] **Step 2.2: Initialize shadcn/ui (matches RunDB setup)**

```bash
npx shadcn@latest init
```

When prompted:
- Style: Default
- Base color: Slate (or Zinc to match dark theme)
- CSS variables: yes
- Tailwind: yes (already)
- Components dir: `components`
- Use `cn` utility: yes

This creates `components.json` and `components/ui/` with button, card, etc.

- [ ] **Step 2.3: Install common shadcn components we will need**

```bash
npx shadcn@latest add button card badge dialog dropdown-menu tabs table toast sonner input select textarea
```

(Toast via sonner for consistency with RunDB.)

- [ ] **Step 2.4: Commit**

```bash
git add .
git commit -m "chore: add next-auth, octokit, shadcn/ui, and core deps"
```

---

### Task 3: Set up authentication with GitHub OAuth (next-auth v4)

**Files:**
- Modify: `pr-hub/app/layout.tsx`
- Create: `pr-hub/app/api/auth/[...nextauth]/route.ts`
- Create: `pr-hub/lib/auth.ts`
- Modify: `pr-hub/app/page.tsx` (temporary sign-in button)

- [ ] **Step 3.1: Create the NextAuth API route**

Create file `pr-hub/app/api/auth/[...nextauth]/route.ts` with:

```ts
import NextAuth from "next-auth";
import GitHubProvider from "next-auth/providers/github";

const handler = NextAuth({
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "repo read:user", // repo scope required for PR writes and conflict resolution
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      // @ts-ignore
      session.accessToken = token.accessToken;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET, // generate with `openssl rand -base64 32`
});

export { handler as GET, handler as POST };
```

- [ ] **Step 3.2: Add NEXTAUTH_SECRET to .env.example and instruct user**

Append to `.env.example`:

```env
NEXTAUTH_SECRET=generate_with_openssl_rand_-base64_32
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 3.3: Update root layout to include SessionProvider and Toaster**

Replace `pr-hub/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "PR Hub — Personal GitHub & Services Command Center",
  description: "Approve, merge, and let AI resolve conflicts on your PRs. Quick view into Vercel, Notion, Canva.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SessionProvider>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </SessionProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3.4: Add a simple Sign In button in the home page for testing**

For now, update `pr-hub/app/page.tsx` (we will replace the whole dashboard later):

```tsx
import { signIn, signOut } from "next-auth/react";
import { useSession } from "next-auth/react";

export default function Home() {
  const { data: session } = useSession();

  return (
    <div className="p-8">
      <h1 className="text-3xl font-semibold">PR Hub</h1>
      {session ? (
        <div>
          Signed in as {session.user?.email}
          <button onClick={() => signOut()}>Sign out</button>
        </div>
      ) : (
        <button onClick={() => signIn("github")}>Sign in with GitHub</button>
      )}
    </div>
  );
}
```

- [ ] **Step 3.5: Generate a NEXTAUTH_SECRET locally and add to .env.local (user does this)**

Run in pr-hub:

```bash
openssl rand -base64 32
```

User pastes into `.env.local`.

- [ ] **Step 3.6: Test auth**

```bash
npm run dev
```

Go to http://localhost:3000 , click sign in. Should redirect to GitHub, then back.

Commit after successful test.

```bash
git add .
git commit -m "feat: add GitHub OAuth with next-auth (repo scope)"
```

---

### Task 4: Implement core GitHub client and types

**Files:**
- Create: `pr-hub/lib/github.ts`
- Create: `pr-hub/types.ts`

- [ ] **Step 4.1: Define core types in `pr-hub/types.ts`**

```ts
export type PR = {
  id: number;
  number: number;
  title: string;
  repo: string; // "owner/repo"
  author: string;
  state: "open" | "closed";
  headSha: string;
  baseRef: string;
  hasConflicts: boolean;
  url: string;
  createdAt: string;
};

export type AIResolution = {
  prNumber: number;
  repo: string;
  confidence: number;
  summary: string;
  resolvedFiles: string[];
  applied: boolean;
  appliedCommitSha?: string;
  auditId: string;
  timestamp: string;
};

export type AuditEvent = {
  id: string;
  timestamp: string;
  type: "ai_resolution" | "pr_approve" | "pr_merge";
  details: any;
};
```

- [ ] **Step 4.2: Implement GitHub client in `pr-hub/lib/github.ts`**

This file will contain functions using Octokit with the access token from session.

Basic skeleton (we will fill more in later tasks):

```ts
import { Octokit } from "@octokit/rest";

export function getOctokit(accessToken: string) {
  return new Octokit({ auth: accessToken });
}

export async function listOpenPRs(accessToken: string): Promise<PR[]> {
  const octokit = getOctokit(accessToken);
  // TODO: implement in Task 5 - fetch from user's repos or important ones
  return [];
}

// More functions added in subsequent tasks: getPR, createReview, mergePR, checkConflicts, applyAIResolution
```

- [ ] **Step 4.3: Commit**

```bash
git add .
git commit -m "feat: add core types and Octokit client skeleton"
```

---

### Task 5: Build the main dashboard and PR list (MVP UI)

**Files:**
- Modify: `pr-hub/app/page.tsx` (full dashboard)
- Create: `pr-hub/components/pr-card.tsx`
- Create: `pr-hub/components/module-tile.tsx`
- Create: `pr-hub/app/prs/page.tsx` (basic list)

- [ ] **Step 5.1: Create reusable PRCard component**

`pr-hub/components/pr-card.tsx`:

```tsx
import { PR } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function PRCard({ pr }: { pr: PR }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/prs/${pr.repo.replace("/", "/")}/${pr.number}`} className="font-medium hover:underline">
            {pr.repo}#{pr.number} — {pr.title}
          </Link>
          <div className="text-sm text-muted-foreground mt-1">
            by {pr.author} • {new Date(pr.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex gap-2">
          {pr.hasConflicts && <Badge variant="destructive">Conflicts with main</Badge>}
          <Badge variant="secondary">{pr.state}</Badge>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link href={`/prs/${pr.repo.replace("/", "/")}/${pr.number}`}>Details</Link>
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2: Build the main dashboard page**

Replace `pr-hub/app/page.tsx` with a dashboard that shows PRs needing attention + module tiles.

For now, hardcode some data or fetch from a server action (we will connect real data in next tasks).

Include a "AI Daily Brief" card.

Add sign out button in header.

- [ ] **Step 5.3: Add basic /prs list page**

Simple list using the PRCard.

- [ ] **Step 5.4: Test the UI**

Run dev, sign in, see the dashboard.

Commit with "feat: initial dashboard and PR list UI with cards"

---

### Task 6: Implement GitHub PR fetching and basic actions

**Files:**
- Modify: `pr-hub/lib/github.ts` (add listOpenPRs, getPR, createReview, mergePR)
- Create: `pr-hub/app/actions/github.ts`
- Update pages to use real data via server actions

- [ ] **Step 6.1: Implement listOpenPRs and check for conflicts in lib/github.ts**

Use octokit.pulls.list and then check mergeable state or manually compare.

For conflict detection: fetch the PR and see if `mergeable === false` and base is main.

- [ ] **Step 6.2: Create server actions for approve and merge**

In `pr-hub/app/actions/github.ts`:

```ts
"use server";
import { getServerSession } from "next-auth";
import { getOctokit } from "@/lib/github";

export async function approvePR(repo: string, number: number) {
  const session = await getServerSession();
  if (!session?.accessToken) throw new Error("Not authenticated");
  const octokit = getOctokit(session.accessToken as string);
  await octokit.pulls.createReview({
    owner: repo.split("/")[0],
    repo: repo.split("/")[1],
    pull_number: number,
    event: "APPROVE",
  });
}
```

Similar for merge.

- [ ] **Step 6.3: Wire the actions into the PR detail page**

Create the detail page with buttons that call the actions and show toasts.

- [ ] **Step 6.4: Test end-to-end with a real PR**

Commit.

---

### Task 7: Implement the high-autonomy AI Conflict Resolver (core feature)

**Files:**
- Modify: `pr-hub/lib/ai.ts` (full implementation)
- Modify: `pr-hub/lib/github.ts` (add applyResolutionViaGitDataAPI)
- Create: `pr-hub/app/actions/ai-resolve.ts`
- Create: `pr-hub/components/ai-resolver.tsx`
- Update PR detail page to include the resolver panel

- [ ] **Step 7.1: Build the AI caller in lib/ai.ts**

```ts
export async function resolveConflictWithGrok(
  baseContent: string,
  prContent: string,
  mainContent: string,
  prDescription: string,
  filePath: string
): Promise<{ resolved: string; confidence: number; summary: string }> {
  const prompt = `You are an expert senior engineer. Resolve the merge conflict between the PR change and main for file ${filePath}.
Base (main at merge-base):
${baseContent}

PR version:
${prContent}

Current main:
${mainContent}

PR context: ${prDescription}

Return ONLY valid JSON: { "resolvedCode": "...", "confidence": 0-100, "summary": "one sentence why this resolution" }`;

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-2-latest", // or latest available
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return {
    resolved: parsed.resolvedCode,
    confidence: parsed.confidence,
    summary: parsed.summary,
  };
}
```

- [ ] **Step 7.2: Implement the Git commit logic using Git Data API in lib/github.ts**

Function `applyAIResolution` that:
- Gets current PR head
- Creates blobs for the resolved files
- Creates new tree
- Creates commit
- Updates the ref

- [ ] **Step 7.3: Create the server action that orchestrates detection → AI → (auto) apply**

`pr-hub/app/actions/ai-resolve.ts`

Logic:
- If confidence > 80 and not blocked → auto apply + audit
- Else → return suggestion for UI review

- [ ] **Step 7.4: Build the AIResolver React component**

Shows button "Resolve with AI", then after call: confidence bar, summary, before/after diff (simple), Accept / Edit / Reject buttons.

- [ ] **Step 7.5: Integrate into PR detail page**

- [ ] **Step 7.6: Add audit logging**

Simple append to a `audit.log` file in the project root for v1.

- [ ] **Step 7.7: Test with a real conflicting PR (create one if needed for testing)**

Commit with message about the AI resolver.

---

### Task 8: Add the general modules (Vercel, Notion, Canva, AI Brief)

**Files:**
- Create the four module pages and tiles
- Implement minimal clients in lib/integrations/
- Add the AI Brief generator using Grok (aggregates status)

- [ ] **Step 8.1: Implement basic Vercel tile and page**

Use fetch to Vercel API with token. Show projects and latest deploy status.

- [ ] **Step 8.2: Same for Notion** (list tasks from a database)

- [ ] **Step 8.3: Canva** (list recent designs, thumbnails if possible via API)

- [ ] **Step 8.4: AI Daily Brief**

Call Grok with a prompt that takes the current module statuses and produces a nice summary + action items.

Show it prominently on the dashboard.

- [ ] **Step 8.5: Make tiles clickable and link to their pages**

- [ ] **Step 8.6: Test all modules with real tokens**

Commit.

---

### Task 9: Polish, audit log viewer, and deployment prep

**Files:**
- Add audit log viewer page or section
- Add settings page for AI confidence threshold and "never auto" repos
- Final UI polish (loading states, error boundaries, empty states)
- Update README with setup instructions
- Add .env.local.example usage in docs

- [ ] **Step 9.1: Create /audit page that reads the audit log and displays AI resolutions**

- [ ] **Step 9.2: Add simple settings (localStorage for now)**

- [ ] **Step 9.3: Improve error handling and toasts everywhere**

- [ ] **Step 9.4: Write README.md with:**

  - How to create GitHub OAuth App
  - Required scopes
  - How to get xAI key
  - How to connect other services
  - How the AI auto-resolver works and safety features

- [ ] **Step 9.5: Final commit and tag as v0.1**

---

### Task 10: (Optional but recommended) Add basic tests for the AI resolver and GitHub client

- Use Vitest or Jest
- Mock Octokit and fetch for Grok
- Test the confidence logic and audit creation

This keeps the plan TDD-friendly where critical.

---

**Plan self-review notes (done by me):**
- All requirements from the approved spec are covered by at least one task.
- No placeholders.
- Tasks are bite-sized (2-10 minutes each when executed).
- Exact commands and code snippets included.
- Focus on the high-autonomy AI resolver as the star feature.
- Security and audit emphasized.
- Ready for subagent-driven or inline execution.

**Next after this plan is approved by user:** We will use the subagent-driven-development skill (recommended) or executing-plans to implement task by task with reviews.

The separated hub is now fully planned and ready to be built. 

Save this plan and present to user.