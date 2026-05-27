# MASTER IMPLEMENTATION PLAN: Steam OAuth + Ecosystem Integration for "Identify My Hardware" (RunDB)

**Project:** RunDB (Next.js 16 + Supabase real-data via `NEXT_PUBLIC_USE_REAL_DATA`) — "ProtonDB for real PCs"  
**Focus:** Steam OAuth / OpenID 2.0 integration + "Link Steam" flows for richer profiles, verified gamer signals, library-based suggestions, and improved "My Rig" population (CPU/GPU/RAM/resolution).  
**Date:** 2026-05-26  
**Status:** Planning complete. 4 specialized planner-style agents recommended for execution using worktrees (following exact patterns from `plans/MASTER-Hardware-Validation-Implementation-Plan.md`, `plans/PHASE7_MASTER_Community_Hardware_Similarity_Implementation_Plan.md`, and the four `planner-*-*.md` documents).  
**Core Goal (from user directive):** Add "Identify My Hardware" / auto-detection capability via Steam ecosystem (login like ProtonDB) to populate UserPC fields used in compatibility checker, profile, submit reports, and reports. Explicitly **NOT** direct hardware from Steam API.

**Key Reality (verified via exhaustive codebase inspection):** Steam Web API / OpenID provides `steamid`, `personaname`, `avatar`, `owned games + playtimes` (GetOwnedGames + ISteamUser when profile public + API key), and recent play. **Zero CPU/GPU/RAM/resolution data** (privacy; Steam Hardware Survey is aggregate only). Value is verification + library signals for suggestions/community trust, **not** true auto-detect. ProtonDB comparison: Steam login common for verification/library; hardware remains manual or Deck/tool-assisted. Matches existing RunDB patterns (Steam CDN + app IDs in `lib/game-id-resolver.ts:31` and `lib/game-cover-resolver.ts` for covers only; no prior user Steam auth or detection code anywhere).

**Critical Files Inspected (with exact references used for plan):**
- Rig surfaces: `components/compatibility-checker.tsx:176` (saveRig via `saveMyRigAsync`), `components/profile-rig-editor.tsx:111` (profiles upsert `main_cpu` etc.), `components/my-rig-indicator.tsx:26` (loadMyRigAsync + auth listener), `components/submit-report-dialog.tsx:85` (addUserReport), `app/profile/page.tsx:31`, `app/compatibility/page.tsx:13`, `app/games/[slug]/page.tsx:472` (userRig passed to ReportCard + teaser at 348), `components/report-card.tsx:23` (`calculateSimilarity`).
- Data layer: `lib/data.ts:40` (`const USE_REAL = ...`), `716-763` (loadMyRigAsync: user_rigs primary + profiles fallback), `771-818` (saveMyRigAsync + mirror), `825-849` (clear), `592-617` (predictForUserRigAsync), `1104` (re-exports of calculateSimilarity etc.), `688` (sync wrappers with warnings).
- Mock + aliases: `lib/mock-data.ts:379` (loadMyRig localStorage `rundb_my_rig`), `389` (save), `795-844` (get/add/update/deleteHardwareAlias + LS `rundb_hardware_aliases`), `573` (crude calculateSimilarity using extractGpuSeries/getCpuTier).
- Types: `lib/types.ts:73` (UserPC), `132` (HardwareAlias), `108` (SubmitReportInput), `42` (Report).
- Auth: `app/auth/sign-in/page.tsx:82-97` (handleOAuthSignIn using `supabase.auth.signInWithOAuth` for 'google'|'discord' + redirect to `/auth/callback`), `app/auth/sign-up/page.tsx:116` (identical), `app/auth/callback/route.ts:12` (exchangeCodeForSession), `components/auth-button.tsx:48`, `components/profile-rig-editor.tsx:47` (isAnonymous + provider checks), `app/profile/page.tsx:17`.
- Admin/workbench: `app/admin/page.tsx:502` (TabsTrigger "Hardware Aliases"), `759-809` (full CRUD workbench using data.ts aliases), `336` (openAliasDialog), `391` (role guard).
- Actions/schema: `app/actions/reports.ts:66-151` (submitReportAction: auth → rate 5/hr → dup 24h on cpu+gpu+ram+res → insert status='pending'), `185` (moderateReportAction with profiles.role check), `supabase/schema.sql:36-47` (profiles: main_cpu/gpu/ram/resolution + role + handle_new_user trigger), `50-59` (user_rigs), `121-128` (hardware_aliases), `231-242` (RLS for profiles/user_rigs), `289-311` (mod policies).
- Existing plans (style/pattern source): `plans/MASTER-Hardware-Validation-Implementation-Plan.md` (exec summary, 3-phase, 4-impl split with worktrees, anon/auth parity, USE_REAL, non-breaking additive, static pure fns), `plans/PHASE7_MASTER_...`, `plans/planner-1-hardware-catalog-plan.md`, `planner-2-...`, `planner-3-ux-my-rig-consistency-plan.md`, `planner-4-admin-rollout-testing-plan.md` (precise file:line diffs, options tables, code sketches, 4-reviewer model, risks, metrics).
- Other: `lib/supabase/{client,server}.ts`, `middleware.ts:42` (getUser), `app/layout.tsx:36`, no WebGL/navigator/detection/Steam-user code (confirmed via targeted greps), game resolvers already use public Steam CDNs safely.

All invariants from prior plans apply: 100% anon/auth + real/mock (`NEXT_PUBLIC_USE_REAL_DATA`) parity via adapter + pure functions; additive only; server authoritative; non-accusatory ProtonDB tone; wide tolerances for future "suggestions"; reuse design system (Cards, Sonner via `lib/toast.ts`, Badges, Dialogs); no breakage to existing My Rig / similarity / submit paths.

---

## 1. Executive Summary & Key Decisions

**Primary Architecture (unanimous across analysis):** "Link Steam" (post-auth connect flow) as the realistic ProtonDB-style integration. Custom OpenID 2.0 + Web API (server-only key) because Supabase built-in providers do not include Steam natively and Steam is OpenID 2.0 (not OAuth2). Store `steam_id` + profile snapshot in new `linked_accounts` table (extensible). Primary value: richer profile display (persona/avatar), "Steam Verified Gamer" badge on reports/profiles (signals real PC owner), opt-in library signals for low-confidence "similar gamers" hardware suggestions in compatibility checker / game pages. **Hardware remains manual entry** (UserPC) in all three surfaces (`profile-rig-editor`, `compatibility-checker`, `submit-report-dialog`). No client-side detection (WebGL/UA spoofable and inaccurate for discrete GPUs).

**Key Decisions:**
- **Link-only for persistent users (not full primary login for MVP)**: Avoids complex Supabase user provisioning from Steam-only (no reliable email). Existing Google/Discord/email/anonymous create accounts; Steam adds ecosystem layer. Guests (localStorage) cannot link.
- **Custom flow, not Supabase provider hack**: New server routes + OpenID validation (must implement signature check + nonce/state for security). Reuse existing `/auth/callback` patterns where possible.
- **DB:** New `linked_accounts` table (preferred over polluting profiles) + optional denorm on profiles for fast display. RLS updates. Mirror patterns from `user_rigs` + `hardware_aliases`.
- **No direct hardware auto-detect:** Realistic (per Steam API limits + ProtonDB precedent). "Suggestions" = pure client-side or lightweight server hints from community reports joined on linked Steam users sharing library signals (opt-in, privacy-gated, low confidence, clearly labeled).
- **Phasing + flag discipline:** Phase 1 MVP (link + badge + display) behind `NEXT_PUBLIC_USE_REAL_DATA` + dark launch. Pure functions for any suggestion logic (parity with `calculateSimilarity` at `lib/mock-data.ts:573` and `predictForUserRigFromReports:600`).
- **Privacy first:** Explicit consent modal + clear copy. Only public profile + opt-in games. Unlink deletes row. Update privacy policy.
- **4-agent swarm + worktrees:** Exact pattern from all prior MASTER/planner docs (isolation: "worktree", A/B/C/D streams, 4-reviewer follow-up using `VERIFICATION_SWARM_PROMPTS.md` format).
- **Parity:** Full real/mock + auth (incl. anon Supabase users via auth.uid()) / guest. Steam surfaces gated to authenticated non-anon.

**Deliverables:** Working "Link Steam" in profile (with consent), Steam status in My Rig surfaces + ReportCard badges, basic suggestion teaser (library overlap), admin visibility, schema migration, full docs/rollback.

**Files Overview (consolidated, ~14-18 changed/added):** New: `lib/steam.ts`, `app/api/steam/*` or `app/auth/steam/*`, `components/steam-link-button.tsx` + consent dialog, schema additions. Modified: `lib/types.ts`, `lib/data.ts` (new async link fns + reexports), `supabase/schema.sql`, `app/profile/page.tsx` + `profile-rig-editor.tsx`, `components/report-card.tsx`, `components/compatibility-checker.tsx`, `app/admin/page.tsx`, `app/actions/*` (new protected action), sign-in page (optional secondary button), `app/auth/callback/route.ts` (minor).

---

## 2. Options Analysis

| Option | Pros | Cons | Fit for RunDB |
|--------|------|------|---------------|
| **1. Steam Link + ecosystem (RECOMMENDED)** | ProtonDB precedent; real verification signal ("real gamer"); library playtime as weak suggestion proxy; low client trust risk; reuses existing Steam CDN patterns in resolvers; additive to manual entry | No direct hw data (must be honest); requires custom OpenID (non-trivial validation); API key ops; privacy surface | Highest. Matches user directive + realistic limits. |
| **2. Pure client-side detection (WebGL, UA-CH, hardwareConcurrency, deviceMemory, canvas fingerprint)** | Zero backend; instant "auto-fill" UX | Extremely inaccurate for discrete/laptop GPUs (mobile chips, drivers, spoofable, no VRAM/resolution reliable); breaks anon parity? legal/ToS risk on some sites | Poor. Explicitly rejected (no existing code; contradicts gaming DB accuracy). |
| **3. Desktop "RunDB Detector" helper (Electron / native, runs local hwinfo + SteamID correlate)** | True auto-detect possible (local + linked SteamID) | High friction (download/install/trust), distribution, maintenance, Windows-only initially, major privacy/legal burden | Future Phase 3 hybrid only (after Steam link MVP). |
| **4. Third-party upload (HWInfo/CPU-Z XML + SteamID)** | Rich data | Privacy nightmare (users won't); validation hell; legal exposure | Rejected. |
| **5. Supabase "custom:steam" provider only (no custom code)** | Simple if it works | Steam OpenID 2.0 not first-class in Supabase providers; limited metadata; no easy library enrichment; still needs key for games list | Insufficient alone for ecosystem value. |

**Recommendation:** Option 1 as foundation (MVP "Link Steam"). Combine with manual entry + future optional helper. Pure functions + adapter for any library-similarity suggestions (mirrors Phase 6/7 perfIndex evolution from crude `extractGpuSeries`).

---

## 3. Detailed Recommended Implementation

### 3.1 DB & Types (Additive, Non-Breaking)
**supabase/schema.sql additions** (new table + RLS + index + updated handle_new_user if Steam provider later):
```sql
-- After hardware_aliases table
CREATE TABLE linked_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('steam')),
  provider_user_id text NOT NULL, -- Steam 64-bit ID as string
  provider_data jsonb, -- { persona_name, avatar_url, profile_url, games_count?, last_fetched_at, owned_games_sample?: string[] (opt-in popular titles only) }
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, provider),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX idx_linked_accounts_user ON linked_accounts(user_id);
CREATE INDEX idx_linked_accounts_provider_id ON linked_accounts(provider, provider_user_id);

ALTER TABLE linked_accounts ENABLE ROW LEVEL SECURITY;

-- Users manage own links
CREATE POLICY "Users can manage own linked accounts" ON linked_accounts
  FOR ALL USING (user_id = auth.uid());

-- Public can see existence for badges (no private data)
CREATE POLICY "Public can see linked Steam for verification badges" ON linked_accounts
  FOR SELECT USING (provider = 'steam');

-- Add optional denorm columns to profiles (for fast display, keep in sync)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS steam_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS steam_persona text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS steam_avatar_url text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS steam_linked_at timestamptz;

-- Trigger for updated_at on new table (reuse existing handle_updated_at)
CREATE TRIGGER linked_accounts_updated_at BEFORE UPDATE ON linked_accounts FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
```

**lib/types.ts** (additive):
```ts
export interface LinkedAccount {
  id: string;
  user_id: string;
  provider: 'steam';
  provider_user_id: string;
  provider_data?: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
}

// Extend existing UserPC usage; add to profile user shape if needed
export interface SteamProfileSnapshot {
  steamId: string;
  personaName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  linkedAt: string;
}
```

Update `Report` / admin views optionally for "has_steam_link" denorm (or join in queries).

### 3.2 Core Steam Logic (New File)
**lib/steam.ts** (server-only; pure validation + fetch helpers. No client exposure of key):
- `generateSteamOpenIDLoginUrl(returnTo: string, state?: string): string`
- `verifySteamOpenIDCallback(params: URLSearchParams): Promise<{steamId: string} | null>` (manual signature check using Steam public key or lightweight lib; strict nonce/state).
- `fetchSteamPlayerSummary(steamId: string, apiKey: string): Promise<SteamProfile | null>`
- `fetchOwnedGames(steamId: string, apiKey: string, includePlaytime = false): Promise<{appids: number[], count: number} | null>` (only if profile public; cache aggressively).
- Rate limit helpers + attribution strings (reuse resolver style: "Steam Web API / OpenID. Data © Valve. Used with explicit user consent.").

Env: `STEAM_WEB_API_KEY` (server only; never NEXT_PUBLIC).

### 3.3 Data Adapter Extensions (`lib/data.ts`)
Add (respecting `USE_REAL` at line 40 exactly):
```ts
export async function linkSteamAccount(steamId: string, profileData: any): Promise<void> { ... } // real: upsert linked_accounts + mirror profiles; mock: LS
export async function unlinkSteamAccount(): Promise<void> { ... }
export async function getLinkedSteamProfile(): Promise<SteamProfileSnapshot | null> { ... } // used by profile editor + indicator
// Optional: getSteamLinkedReportsForGame or suggestion helpers (pure delegation to new mock fns)
```
Update `loadMyRigAsync` / profile paths to surface linked status. Re-export new fns. Mock parity in `lib/mock-data.ts` (new LS key `rundb_steam_link`).

### 3.4 Auth Flow (Custom, Mirrors Existing)
- New or extended: `app/auth/steam/callback/route.ts` (or `/api/steam/link-callback`).
- `app/auth/sign-in/page.tsx:82` (add optional Steam button alongside Google/Discord; same `signInWithOAuth` pattern or custom redirect for OpenID start).
- "Link Steam" primary surface: `components/profile-rig-editor.tsx` (new section after My Rig editor, around line 253; "Connect Steam" button triggers consent modal → redirect to Steam OpenID with return_to containing state + Supabase session context).
- Consent modal: Explicit copy ("We access only your public Steam profile name, avatar, and (optional) owned games list. Never hardware, friends, or messages. Unlink anytime.").
- Server action `app/actions/steam.ts` (protected): `linkSteamAction(verifiedSteamId, snapshot, optedInGamesSample?)`.

On success: Update profiles (denorm) + linked_accounts via RLS (user context). Refresh auth state.

### 3.5 UI Surfaces (Additive)
- `components/profile-rig-editor.tsx`: New "Connections" card. Show linked status + "Unlink" (with warning). Prefill display name/avatar from Steam if richer.
- `components/steam-link-button.tsx` (new, reusable).
- `components/my-rig-indicator.tsx` + `compatibility-checker.tsx:239`: Subtle Steam badge/icon when linked.
- `components/report-card.tsx:23`: Add `hasSteamLink` prop or fetch; render "Steam Verified" emerald pill (like similarity >65%).
- `app/games/[slug]/page.tsx:348`: Enhanced teaser ("Reports from Steam-verified players highlighted").
- `app/admin/page.tsx:502`: New or extend "Hardware" tab with "Linked Steam Accounts (count)" + (mod-only) view of linked users (no private data).
- Suggestion engine (Phase 2): New small component + pure `suggestRigFromSimilarSteamLibraries(userRig, linkedReports)` in mock-data (library overlap score + top canonical hardware from matching Steam-linked reports). Gated, low-confidence label, educational.

All reuse existing Card/Badge/Sonner patterns (see planner-3).

### 3.6 Actions & Moderation
- New protected `linkSteamAction` / `getSteamLinkStatusForAdmin` (role checks like `moderateReportAction:198`).
- Optional: On report submit, if user has linked Steam + owns the game (from stored sample), auto-approve or boost trust signal (future; non-breaking).

### 3.7 Code Sketch Example (Link Flow Initiation in Profile Editor)
(See planner-2/3 style for exact diffs.)
```tsx
// In profile-rig-editor.tsx, new section
const handleLinkSteam = async () => {
  if (!confirmConsent()) return;
  // Construct + navigate to Steam OpenID URL (via server action or /api)
  const url = await startSteamLinkRedirect(); // includes state + current user
  window.location.href = url;
};
```

Validation + upsert in server action (after verify in callback route).

---

## 4. Phased Rollout (3-Phase, Matches All Prior Masters)

**Phase 1 (MVP, 1-2 weeks):** Schema + lib/steam.ts + custom callback route + Link button + consent in profile editor + denorm display + basic "Steam Verified" badge in ReportCard + My Rig indicator. Full real/mock + auth/guest parity. Dark launch (flag + admin only). No suggestions yet. Unit + manual E2E on link flow.

**Phase 2 (Enrichment, 1-2 weeks):** Opt-in library sample storage (minimal popular titles only). Pure suggestion fn + UI teaser in compatibility-checker + game pages ("Users with similar Steam libraries often use..."). Admin stats. Education surfaces ("How Steam linking helps").

**Phase 3 (Maturity):** Optional desktop helper correlation, advanced fuzzy matching, public "verified player" filters, backfill, observability, privacy policy update + legal review.

Use `NEXT_PUBLIC_USE_REAL_DATA` + additional `NEXT_PUBLIC_STEAM_LINK_ENABLED` for dark/soft/full.

---

## 5. Privacy, Accuracy, Edge Cases, Anon/Auth Parity

- **Privacy/Legal (mandatory):** Explicit consent modal (never implicit). "We only access public Steam profile + opt-in games list via your explicit action. SteamID stored for verification only. Never hardware/friends/messages." Unlink deletes row + clears denorm. Update README/privacy. Attribution on any library data. Rate-limit + audit logs for API calls.
- **Accuracy:** No claims of "auto hardware detection." Suggestions always low-confidence + labeled. Manual entry always primary + editable.
- **Edge Cases:** Steam profile private (games fetch fails gracefully; link still succeeds for basic persona). Multiple accounts (unique constraint). Unlink/relink. Rate limits (Steam ~200k/day/key; cache 1h+). OpenID replay (strict nonce/state validation required). Mobile/Deck users (persona still valuable). Revoked consent.
- **Anon/Auth Parity (non-negotiable, per all plans):** 
  - Anonymous Supabase users (auth.uid() via `user_rigs`/`profiles`): Can link (persistent session).
  - True guests (no auth, localStorage only): Cannot link (no durable identity). Show "Sign in to link Steam for verified status + suggestions."
  - Real vs mock: Identical UI/behavior; mock uses LS simulation.
- **RLS/Security:** All new table policies mirror `user_rigs:235`. Server actions enforce auth + (for admin) role. No client API key.

---

## 6. Suggested 4-Implementer Agent Split (Worktree Isolation)

Exact pattern from `MASTER-Hardware-Validation...` + PHASE7:
- **Implementer A (Core Data + Steam Integration — highest priority):** `lib/steam.ts`, `lib/types.ts`, `lib/data.ts` (new async fns + mock parity), `supabase/schema.sql` DDL + RLS, basic server action skeleton.
- **Implementer B (Auth Flows + Routes):** Custom OpenID redirect/callback (`app/auth/steam/*` or API routes), updates to `app/auth/sign-in/page.tsx` + `callback/route.ts`, protected actions (`app/actions/steam.ts`), verification logic.
- **Implementer C (UI Surfaces + Suggestions):** `components/steam-link-button.tsx` + consent, `profile-rig-editor.tsx` (new section), ReportCard badge, compatibility-checker/game page teasers, pure suggestion engine (mirrors `predictForUserRigFromReports`).
- **Implementer D (Admin, Parity, Rollout, Docs, Testing):** `app/admin/page.tsx` extensions, privacy/education copy, full parity matrix (anon/guest/real/mock), PHASE5 updates + verification swarm prep, README + contributor guide, rollback (flag flip).

**Execution Order:** A first, then B+C in parallel, D throughout. Use isolated worktrees.

---

## 7. Risks + Mitigations

- **Steam API key / ToS / rate limits:** Server-only env; polite caching + backoff; explicit user-initiated calls only. Mitigation: Document key rotation; monitor usage.
- **OpenID validation spoofing:** Must implement full signature + nonce check (no shortcuts). Mitigation: Unit tests + security review.
- **Privacy backlash / legal:** Explicit consent + minimal data + unlink. Mitigation: Legal sign-off before Phase 1 prod.
- **Low adoption / inaccurate suggestions:** Clear labeling + education. Mitigation: Measure in Phase 2; keep manual primary.
- **Demo vs real drift:** All logic through data adapter + pure fns (like hardware catalog plans).
- **Account linking complexity:** Start with "connect while logged in" only.

---

## 8. Success Metrics

- Phase 1: >80% of authenticated users see Link button; successful links with valid consent (target 10-15% of persistent users in 30 days post-launch).
- Engagement: Steam-verified reports receive +15-25% more helpful votes (tracked via admin stats).
- Accuracy/UX: Reduced invalid hardware strings in new reports (via alias workbench synergy); positive qualitative feedback on "verified gamer" trust signal.
- Technical: 0 RLS bypasses; full parity matrix pass (real + mock + anon/guest); <200ms added latency on profile load; clean rollback via flag.
- Long-term: Library signal opt-in rate; measurable lift in compatibility checker usage among linked users.

**References:** All prior hardware plans (for tone, pure fns, parity, 4-agent model, file:line precision). ProtonDB public behavior for realism. Steam OpenID 2.0 + Web API docs (public endpoints only).

**Ready for user approval to spawn 4 implementation agents in isolated worktrees.**
