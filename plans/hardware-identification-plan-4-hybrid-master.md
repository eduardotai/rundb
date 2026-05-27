# MASTER IMPLEMENTATION PLAN: Hybrid "Identify My Hardware" Auto-Detection (Browser + Paste + Steam + Future Companion) — Full Product Integration & Privacy-First

**Project:** RunDB (Next.js 16 + React 19 + Supabase via `NEXT_PUBLIC_USE_REAL_DATA` flag) — "ProtonDB for real PCs"  
**Focus:** Production-grade "Identify My Hardware" / auto-detection to populate `UserPC` (CPU/GPU/RAM/resolution) for My Rig surfaces (compatibility checker, profile, submit reports, reports). Synthesizes **all approaches** into a unified, privacy-first hybrid:  
- **Primary (zero-friction default):** Client-only browser detection (WebGL `UNMASKED_RENDERER_WEBGL` + navigator heuristics + WebGPU `GPUAdapterInfo` where available).  
- **Secondary (highest trust/accuracy):** Native paste commands (`dxdiag /t`, `lspci`, `system_profiler`, Steam system info export, etc.).  
- **Tertiary (identity + future signals):** Optional Steam link (profile/games only; **explicitly documents zero direct hardware** per Steam Web API limits).  
- **Optional future companion:** Small Tauri/Rust desktop app (local WMI/dxdiag + sysinfo + hwinfo plugin) with "Send to RunDB" (QR, localhost bridge, or clipboard).  
**Date:** 2026-05-26  
**Status:** Planning complete. Synthesized from exhaustive read-only codebase inspection + external research (browser limitations, Steam API reality, Tauri feasibility). Matches exact style, invariants, and 4-planner swarm patterns from `plans/MASTER-Hardware-Validation-Implementation-Plan.md`, `plans/planner-*-hardware-*.md`, `plans/PHASE7_MASTER_...`, and `plans/phase7-planner-*-*.md` (worktree isolation, anon/auth + `USE_REAL` parity, pure functions, additive non-breaking, normalization via aliases + catalog, dark→opt-in→default rollout, rich metrics).  

**Core User Requirement (synthesized):** Allow users (anonymous guests via localStorage **or** authenticated incl. Supabase anonymous via `auth.uid()`) to instantly or reliably populate hardware fields used in `predictForUserRigAsync`, `calculateSimilarity`, report submission, Rig Health/Consistency (Phase 6/7), without friction or privacy compromise. Detected values must immediately compose with existing `HardwareAlias` normalization + `hardware-performance-catalog` (from MASTER validation) for canonicalization + plausibility scoring on save.

**Critical Codebase Facts (from direct tool reads — no summaries):**
- **Rig surfaces (exact insertion points):** 
  - `components/compatibility-checker.tsx:253-268` (CPU/GPU Labels + Inputs in 4-col grid; `saveRig` at 176-201 using `saveMyRigAsync`; auth listener at 96-124 calling `loadMyRigAsync`).
  - `components/profile-rig-editor.tsx:184-201` (CPU/GPU Labels + Inputs in grid; direct Supabase profiles upsert at 111-117; RAM/resolution handling at 207-230; `isAnonymous` logic at 46-54).
  - `components/submit-report-dialog.tsx:130-141` (CPU/GPU in form row; no current "Use my saved rig" prefill — added here; Zod schema at 18-46; `onSubmit` at 76-113 calling `addUserReport`).
  - `components/my-rig-indicator.tsx:26-50` (load/clear via `loadMyRigAsync` + auth listener; GPU snippet display).
  - `app/profile/page.tsx:31`, `app/compatibility/page.tsx:13`, `app/games/[slug]/page.tsx:203` (Submit trigger), `490` (another submit), `503` (dialog), `348-500` (myRig teaser + embedded checker + ReportCard `userRig`).
- **Data layer (USE_REAL discipline):** `lib/data.ts:40` (`const USE_REAL = ...`), `688-707` (sync `load/save/clearMyRig` with warnings), `716-763` (`loadMyRigAsync`: user_rigs primary + profiles fallback for logged-in incl. anon; LS guest fallback), `771-818` (`saveMyRigAsync` + mirror), `825-849` (`clearMyRigAsync`), `1033-1040` (`useMyRig` RQ hook), `627-656` (`addUserReport` branches to `submitReportAction`).
- **Mock + aliases (normalization foundation):** `lib/mock-data.ts:345` (LS_MY_RIG), `379-397` (load/save/clearMyRig), `347` (LS_HARDWARE_ALIASES), `418-446` (loadHardwareAliases + `getDefaultHardwareAliases` seeding 6 entries), `795-844` (get/add/update/deleteHardwareAlias with exact raw dup check), `964` (stats include alias count). Aliases power future canonical matching.
- **Types:** `lib/types.ts:73-78` (UserPC), `132-139` (HardwareAlias), `108-124` (SubmitReportInput), `42-71` (Report with status/moderatorNotes), no detection fields yet.
- **Admin/hardware workbench:** `app/admin/page.tsx:502` (Tabs "Hardware Aliases"), `758-809` (full CRUD table + dialog at 952-988 using data.ts aliases; role guards at 391; stats at 481), `336-400` (openAliasDialog + save/delete).
- **Auth (parity critical):** `app/auth/sign-in/page.tsx:82-97` (OAuth google/discord via `signInWithOAuth`), `127-139` (signInAnonymously), `components/profile-rig-editor.tsx:47-54` (isAnonymous detection), `app/profile/page.tsx:17-27` (guest support messaging). `app/auth/callback/route.ts` + middleware patterns.
- **Actions:** `app/actions/reports.ts:66-151` (`submitReportAction`: auth → rate 5/hr → 24h dup on cpu+gpu+ram+res → insert status='pending'; no hardware validation yet per MASTER), `185-226` (moderateReportAction with `profiles.role` check at 198-206).
- **Schema:** `supabase/schema.sql:50-59` (user_rigs), `36-47` (profiles main_*), `121-128` (hardware_aliases), `62-99` (reports with status/moderator_notes), RLS policies (e.g. 231+ for user_rigs/profiles).
- **No detection exists:** Exhaustive greps (WebGL, navigator, steam hardware, dxdiag, paste, detectHardware, etc.) return **zero** hits in `app/`, `components/`, `lib/` (only plan references + crude `extractGpuSeries`/`calculateSimilarity` at mock-data:573-592 and filter strings in game page:148).
- **Catalog/Phase 6/7 context:** `lib/hardware-performance-catalog.ts` + `normalize-hardware.ts` (or co-located) + `getCanonicalHardware`/`validateHardwarePerformance` (referenced across MASTER + phase7 plans) assumed delivered or co-delivered; detection **must** feed into them. Current alias system is the normalization hook.
- **Existing plans (style/pattern source):** All referenced files (exec summary + key decisions, detailed options table with scores, precise file:line diffs + code sketches, 3-phase with MVP scope, privacy/security/anon/auth notes, 4-impl worktree split, risks/mitigations/monitoring, success metrics + A/B). 100% anon/auth + real/mock parity via adapter + pure client-only fns; additive only (never replaces manual entry); dark launch → opt-in beta → default visible; `USE_REAL` discipline; worktree isolation (`isolation: "worktree"`).

**No Steam/WebGL/detection code to refactor.** All new work is additive. Full parity required (guests use LS only; auth uses DB + same pure logic).

---

## 1. Executive Summary & Key Decisions (Recommended Primary Hybrid)

**All approaches evaluated. Unanimous synthesis (privacy-first, production-grade, full integration):**  
**Primary:** Browser detection (WebGL + heuristics) as instant default "Detect My Hardware" affordance (icon button next to every CPU/GPU label) + "Improve accuracy" upsell. Zero backend, client-only, works for guests.  
**Secondary (always available, highest trust):** Native paste parser (modal with examples for `dxdiag /t`, etc.).  
**Tertiary:** Optional Steam link (enrichment + "verified gamer" signals; **honestly documents** "Steam provides no per-user CPU/GPU/RAM — only profile + games + aggregate survey").  
**Future companion (explicitly scoped out of MVP):** Tauri/Rust desktop (full local WMI + "Send to RunDB" via QR/localhost/copy).  

**Unified facade (new):** `lib/hardware-detector.ts` exports `detectHardware(options: {mode?: 'browser'|'paste'|'steam'|'all'|'companion'})` + submodules (`browser-detector.ts`, `paste-parser.ts`, `steam-enrichment.ts`, `normalizer.ts`). Orchestrates + applies aliases + feeds catalog.  

**Normalization pipeline (deep integration):** Every detected raw string → `applyHardwareAliases(raw, loadHardwareAliases())` (reuse/extend mock-data + future real path) → canonical + vendor/series → `getCanonicalHardware`/`getHardwarePerf` (catalog) for perfIndex + immediate `validateHardwarePerformance` health score on save. "Learn this alias" flow (user suggestion → admin queue or one-click in workbench).  

**All entry points (consistent affordance):**  
1. `CompatibilityChecker` form (save path) + embedded instances.  
2. `ProfileRigEditor`.  
3. `SubmitReportDialog` ("Use my saved rig" + new "Detect fresh" buttons).  

**New UI primitives (small, reusable, accessible):**  
- `<HardwareDetectButton mode="browser" onDetect={...} state={idle|detecting|...} />` (icon + label; lucide Monitor/Scan icon; next to Label).  
- `<DetectedHardwareBanner confidence={0.72} rawGpu="..." canonicalGpu="..." method="browser" onApply={...} onRefine={...} onDismiss={...} />` (amber/educational; state machine "idle | detecting | detected | applied | error").  
- Paste parser modal (modeled on `admin-bulk-import-dialog.tsx`).  
- Graceful degradation + "What we detect and why" expandable (privacy education).

**State machine (per primitive + hook):** "idle | detecting | detected | applied | error" (with confidence, raw vs canonical, method badge, "Apply", "Refine in editor", "Try paste instead").

**Data model extensions (additive, opt-in):** Optional `detection_method` (enum: 'browser'|'paste'|'steam'|'manual'|'companion') + `detected_raw` (jsonb of raw strings) on `user_rigs` + `reports`. Analytics only; never background fingerprinting. Privacy policy note + per-save opt-in toggle.

**Admin extensions:** Hardware tab gains "Bulk import from detected samples" (from opt-in telemetry or mod queue unrecognized), confidence stats, "Unrecognized GPUs/CPUs this week" list (feeds alias suggestions). "Learn alias" from user detections.

**Testing & parity:** 100% for anonymous guests (LS only), real DB users, `USE_REAL` on/off. Pure functions for hot paths (client-only detection + normalization). Compose with Phase 6 validation on every save.

**Rollout (exact prior pattern):** Dark launch (detect only logs + admin-visible), opt-in beta (flag + "Try detect" toggle), then default visible in all 5+ surfaces. Metrics: % rigs detected vs manual, post-detect edit rate, report submission lift, alias learning rate.

**Key Decisions (unified):**  
- Client-only primary (no server fingerprinting ever). Save action is the only persistence point.  
- Hybrid always offers manual fallback + paste as "highest accuracy" path.  
- Steam is enrichment/verification only (per research: **zero** per-user hardware).  
- Tauri companion is future (post-MVP) and explicitly optional.  
- Deep catalog + alias integration (detected rigs get health scores immediately).  
- Non-accusatory, educational tone everywhere ("Browser detection gives a good starting point... Paste for exact match").  
- Exact invariants from all prior hardware plans: additive, `USE_REAL` + adapter, anon/auth parity, static/pure for hot paths + offline, worktree 4-split, PHASE5 verification culture, rollback via flag.

**Files Overview (consolidated ~22-28 new/changed):**  
- **New core:** `lib/hardware-detector.ts` (facade + 4 submodules or sections), `components/hardware-detect-button.tsx`, `components/detected-hardware-banner.tsx`, `components/paste-hardware-modal.tsx`, `lib/normalize-hardware.ts` (if not co-located in catalog), optional `app/api/detect-companion-bridge` stub.  
- **Modified (5+ surfaces + data):** `components/compatibility-checker.tsx` (exact ~253+), `profile-rig-editor.tsx` (~184+), `submit-report-dialog.tsx` (~130+ + prefill), `my-rig-indicator.tsx`, `app/games/[slug]/page.tsx`, `app/profile/page.tsx`, `app/admin/page.tsx` (hardware tab ~758+), `lib/data.ts` (new async detect wrappers + hooks around 1033+), `lib/mock-data.ts` (LS parity + paste examples + enhanced aliases), `lib/types.ts`, `supabase/schema.sql` (optional columns + RLS), `app/actions/reports.ts` (optional detection_method passthrough).  
- **Docs/tests:** Updates to README, privacy policy, PHASE5_*, new unit tests for pure detector/normalizer, E2E parity matrix.

**Deliverable:** End-to-end working hybrid in all surfaces. Detected rigs normalized + validated on save. Full parity. Measurable adoption.

---

## 2. Comprehensive Options Analysis

| Approach | Accuracy (Real-World) | UX / Friction | Privacy / Trust | Implementation Effort | Cross-Browser / Platform | RunDB Fit Score (1-10) | Notes from Research + Codebase |
|----------|-----------------------|---------------|-----------------|-----------------------|--------------------------|------------------------|--------------------------------|
| **Browser (WebGL UNMASKED_RENDERER + WebGPU + UA + concurrency + deviceMemory)** | Medium (70-85% useful model/family on Chrome Win discrete dGPU; <30-50% mixed/FF/Safari/privacy users; generic on Apple Silicon/iGPU/Linux/VM) | Excellent (instant, zero install, 1-click) | Excellent (client-only, no server send until explicit Save; spoofable but transparent) | Low-Medium (pure TS, canvas context, regex parsers; ~300 LOC) | Good on Chrome/Edge; degraded on FF (bucketing since 2021), Safari (generic "Apple GPU"), Brave (extra mitigations 2026) | 9 (primary default) | Confirmed via web research 2026: privacy mitigations dominant; best as "good starting point + upsell". No existing code. |
| **Native Paste (dxdiag /t, lspci -v, system_profiler SPDisplaysDataType, Steam "System Information")** | Very High (exact strings from user machine; user-controlled) | High (copy-paste friction but trusted; examples + one-click copy buttons) | Highest (user explicitly pastes; no auto) | Medium (robust multi-format parser + examples; modal) | Excellent (user provides text from any OS) | 10 (secondary always-on) | Highest trust path. Modeled on existing import dialog. |
| **Steam Link (OAuth/OpenID + profile + owned games opt-in)** | Low for hardware (0 direct CPU/GPU/RAM per Steam Web API; only aggregate survey) | Medium (consent + link flow) | High with explicit consent (already in auth patterns) | Medium (custom OpenID per prior Steam plan; reuses resolvers) | N/A (account-level) | 6 (tertiary enrichment) | **Critical fact:** Confirmed zero per-user hardware (partner.steamgames.com + Web API docs). Value = "Steam Verified" badge + weak library signals for suggestions (Phase 2+). Matches existing Steam CDN usage in game resolvers. |
| **Tauri/Rust Companion App (sysinfo + wmi + dxdiag + tauri-plugin-hwinfo)** | Highest (full local WMI, VRAM, DX feature levels, driver versions, cross-platform) | Medium (download/install/trust barrier; QR/localhost bridge for "send") | High (local-only by default; explicit send) | High (new repo, Rust, distribution, permissions, CI) | Good (Windows strongest; Linux/macOS via sysinfo/wgpu) | 7 (future optional) | Excellent per 2026 research: lightweight vs Electron; plugins + custom commands viable. Explicitly future (post-MVP). |
| **Hybrid (Browser default + Paste always + Steam optional + Companion future) — RECOMMENDED** | Highest composite (browser instant + paste fallback + enrichment) | Highest (choice + progressive) | Highest (client-only primary + explicit everywhere) | Medium-High (unified facade + shared normalizer) | Best (graceful per method) | 10 | Synthesizes all. Matches "Hybrid + Full Product Integration & Privacy-First". Low risk via phased + pure fns. |

**Recommendation:** Hybrid with browser primary + paste secondary as MVP core. Steam as additive identity layer (no hardware claims). Tauri scoped to Phase 3 roadmap. All paths route through single `detectHardware` + normalization that feeds aliases + catalog validation.

---

## 3. Detailed Recommended Implementation

### 3.1 Core Library: `lib/hardware-detector.ts` (New — Facade + Submodules)
```ts
// Unified API (client-only where possible)
export type DetectionMode = 'browser' | 'paste' | 'steam' | 'all' | 'companion';
export type DetectionMethod = 'browser' | 'paste' | 'steam' | 'manual' | 'companion';

export interface DetectedHardware {
  cpu?: string; gpu?: string; ram?: number; resolution?: string;
  raw: { cpu?: string; gpu?: string; ... };
  method: DetectionMethod;
  confidence: number; // 0-1 (browser lower on privacy browsers)
  timestamp: string;
}

export async function detectHardware(options?: { mode?: DetectionMode; pasteText?: string }): Promise<DetectedHardware> {
  // Orchestrates; for 'all' tries browser first, falls back
  if (options?.mode === 'paste' && options.pasteText) return parsePaste(options.pasteText);
  if (options?.mode === 'browser' || !options?.mode) return detectBrowser();
  // steam: enrichment only (profile snapshot)
  // companion: stub for future bridge
}

export function applyHardwareAliases(raw: string, aliases: HardwareAlias[] = []): { canonical: string; vendor?: string; series?: string } {
  // Exact reuse/extend of current alias matching logic (mock-data:799+); case-insensitive, longest match first
  // Returns canonical for catalog lookup
}

export function getNormalizedRig(detected: DetectedHardware): UserPC { ... } // + catalog perf + health
```

**Submodules/sections (colocate or split):**  
- `detectBrowser()`: WebGL context + `WEBGL_debug_renderer_info` (UNMASKED_RENDERER/VENDOR), WebGPU `adapter.info` (description/architecture), `navigator.hardwareConcurrency`, `deviceMemory` (if available), UA-CH hints, resolution from `screen`. Regex parsers for NVIDIA/AMD/Intel + series. Confidence heuristics (lower on Firefox/Safari/Brave). Pure + defensive (try/catch per browser).  
- `parsePaste(text: string)`: Multi-format detector (dxdiag sections, lspci, system_profiler, "GPU: ", "Processor: "). Returns structured + raw. Robust to noise.  
- `steamEnrichment(steamId)`: Client calls server action only on explicit link; returns persona + (opt-in) library overlap hints (no hw).  
- `normalizeAndValidate(detected)`: Alias pass → catalog `getCanonicalHardware` + `validateHardwarePerformance` (immediate health score for banner).  

All pure or client-only. Exported via `lib/data.ts` (respect `USE_REAL` only for persistence paths).

**Integration with catalog/aliases (MANDATORY):** On every detect result, auto-apply aliases. "Learn this alias" button in banner (suggests to admin or user-local until accepted). Detected rigs get catalog perfIndex + validation on save (compose with Phase 6).

### 3.2 UI Primitives (New Small Components)
- `HardwareDetectButton.tsx`: Props for mode, disabled, loading, onDetect (triggers facade + sets detected state). Uses existing Button + lucide (Scan / Cpu / Monitor). Tooltip: "Instant browser scan (best on Chrome/Windows) or paste for exact".
- `DetectedHardwareBanner.tsx`: State-driven (confidence color, method badge "Browser 72% • Windows", raw vs canonical diff highlight, "Apply to form", "Refine / edit", "What we detected and why" <details> with privacy copy, "Try paste instead").
- `PasteHardwareModal.tsx`: Reuses Dialog + Tabs (like bulk-import). Pre-filled examples for Windows (`dxdiag /t`), Linux, macOS, Steam. "Parse & Preview" button. On success → same Detected banner flow.

**State machine implementation:** Local `useState<DetectionState>` or small hook `useHardwareDetection()`. Transitions: idle → detecting (spinner) → detected (banner) → applied (toast + form update) or error (graceful fallback message).

**Insertion pattern (example for checker — copy to others):**  
Next to `<Label>CPU</Label>` (line 253): `<div className="flex items-center justify-between"><Label>CPU</Label><HardwareDetectButton ... /></div>` then conditional banner below input.

### 3.3 Updates to Existing Components (Precise)
- **compatibility-checker.tsx** (~253-287 form grid, 176 saveRig, 66 load): Add buttons + banner per field group. On apply: set* + optional auto-save. Wire to new `useHardwareDetection` + `saveMyRigAsync`.
- **profile-rig-editor.tsx** (~184-230 inputs): Identical buttons + banners. On apply + save: persist (profiles + user_rigs mirror). Respect `isAnonymous`.
- **submit-report-dialog.tsx** (130-172 hardware row + form): Add "Use my saved rig" (loadMyRigAsync prefill) + "Detect fresh" buttons. Banner in dialog. On submit: include optional `detection_method`.
- **my-rig-indicator.tsx** + game detail teaser: Subtle "Detected" badge or "Improve with paste" link.
- **admin/page.tsx** (~758 hardware tab): New sub-section "Detected Samples & Alias Learning" (bulk import from opt-in detections, unrecognized list, confidence stats, "Add as alias" quick action). Extend stats tile.
- **report-card.tsx** / game pages: Optional `detectionMethod` display on owner reports.

**Data adapter (`lib/data.ts`):** New `detectHardware(...)` (pure delegation), `saveDetectedRig(...)` wrappers, `useHardwareDetection` hook (light). Extend `load/saveMyRigAsync` to optionally record method/raw (opt-in column).

**Mock parity (`lib/mock-data.ts`):** LS keys for detected history, paste examples, enhanced alias seeding. Simulate browser results for demo.

**Actions (`app/actions/reports.ts`):** Passthrough `detection_method` (additive to insert; used for analytics/moderation filters).

**Schema (additive):** Optional columns on `user_rigs` + `reports`: `detection_method text`, `detected_raw jsonb`. RLS: owner-only write. Public read filtered.

**Types (`lib/types.ts`):** Extend `UserPC` optionally with `detectionMethod?`, new `DetectedRig` interface, update `SubmitReportInput`.

### 3.4 Privacy by Design (Core)
- Detection **never** sends to server until explicit "Apply + Save".
- Clear expandable "What we detect and why" (lists WebGL renderer string, no fingerprinting).
- Per-save opt-in for storing raw/method (default off for analytics).
- No background runs. "Unlink / forget detections" easy.
- Update privacy policy + footer note. Attribution on any Steam signals.

---

## 4. Phased 3-Phase Plan with Clear MVP Scope

**Phase 1 — MVP Foundation (1-2 weeks, dark launch ready):**  
- New `lib/hardware-detector.ts` (browser + paste core + alias integration stub).  
- Primitives + insertion in 3 primary surfaces (checker, profile editor, submit dialog).  
- "Use my saved rig" + "Detect" affordances + banner + state machine.  
- Basic normalization (aliases) + catalog hook (assume Phase 6 catalog present).  
- Admin "Detected samples" read-only viewer + stats.  
- Full LS (guest) + DB (auth) parity via data adapter + pure fns. `USE_REAL` respected.  
- Dark launch: detection logs only (flag-controlled visibility).  
- Tests: pure detector/parser unit cases (10+), manual E2E parity matrix.  
**MVP Deliverable:** Working browser instant + paste in forms. Detected values editable/normalized on save. No server send until Save.

**Phase 2 — Enrichment + Polish (~2 weeks):**  
- Steam link integration (tertiary, per prior Steam plan patterns) + "Verified" badges + weak library suggestions (pure fn).  
- Full catalog composition (health scores on detected rigs). "Learn alias" flows (user → admin workbench).  
- Paste modal polish + more formats. Error recovery + cross-browser graceful degradation.  
- Admin bulk import from samples + unrecognized queue.  
- Education surfaces everywhere + privacy policy update.  
- Opt-in beta (visible to all with toggle).  
- Expanded RQ hooks, toast patterns, a11y.

**Phase 3 — Maturity + Companion (future):**  
- Tauri companion bridge (QR/localhost/copy "Send to RunDB").  
- Advanced signals (driver versions, VRAM where available).  
- Analytics dashboards (adoption, edit-after-detect, alias learning velocity).  
- Public "how detection works" page. Backfill + advanced A/B.

**Rollout gates (exact prior pattern):** Feature flag `NEXT_PUBLIC_HARDWARE_DETECTION` (dark → soft → full). Monitor fallbacks.

---

## 5. Privacy, Security, Legal, Accuracy, Cross-Browser, Edge Cases, Anon/Auth Notes

- **Privacy (non-negotiable):** Client-only primary. Explicit consent/education everywhere. Raw data only on explicit save + opt-in toggle. No fingerprinting. Unlink easy. Legal review before prod (browser strings can be fingerprinting vectors in some jurisdictions).
- **Security:** All parsing defensive (no eval, length caps via existing sanitizeFullName). Paste is user-initiated only. Future companion: local-first, capability-gated.
- **Legal:** Document "best effort" + limitations. Steam: honest "no hardware data". Attribution. Update ToS/privacy.
- **Accuracy:** Browser = starting point (clear labeling). Paste = gold standard. Always editable. Wide catalog tolerances (Phase 6) absorb variance. Unknown hardware → graceful "manual review recommended".
- **Cross-browser:** Test matrix (Chrome Win best; FF/Safari lower confidence + "paste recommended"; mobile degraded). Feature-detect WebGL/WebGPU.
- **Edge cases:** Privacy-hardened browsers (spoofed → low confidence banner), multi-GPU (primary discrete preferred), laptops (power limits noted in education), VMs (detect as non-gaming), resolution from screen vs reported, RAM from heuristics only (paste for exact), duplicate alias handling.
- **Anon/Auth parity (mandatory, per all plans):** Guests: LS only, full detection works. Auth (incl. anonymous Supabase users): DB persistence + same pure client logic. Steam link gated to non-anon persistent accounts. Real vs mock: identical behavior (adapter + LS simulation).
- **Catalog/alias synergy:** Every detection runs alias normalizer + catalog validation before any UI suggestion or save.

---

## 6. Suggested 4-Implementer Split Using Worktrees (Map to Files/Areas)

Use isolated git worktrees exactly as `MASTER-Hardware-Validation-Implementation-Plan.md:73-105` and phase7-planner-4.

- **Implementer A — Core Detector + Normalization (highest priority, unblocks all):** `lib/hardware-detector.ts` (full facade + browser + paste + normalizer + alias integration + catalog hooks), `lib/types.ts`, `lib/normalize-hardware.ts` (or internal), initial pure unit tests. Re-exports via data.ts.
- **Implementer B — UI Surfaces + Entry Points:** New primitives (`hardware-detect-button.tsx`, `detected-hardware-banner.tsx`, `paste-hardware-modal.tsx`), full wiring + state machines in `compatibility-checker.tsx`, `profile-rig-editor.tsx`, `submit-report-dialog.tsx`, `my-rig-indicator.tsx`, game/profile pages. "Use my saved rig" + banners.
- **Implementer C — Data Layer, Persistence, Steam Tier, Actions:** `lib/data.ts` (async wrappers, hooks, USE_REAL branches around myRig paths), `lib/mock-data.ts` (LS parity + examples + enhanced aliases), `supabase/schema.sql` (optional columns + RLS), `app/actions/reports.ts` (passthrough), Steam enrichment stubs + link flow (coordinate with prior Steam plan), `useMyRig` / save paths.
- **Implementer D — Admin, Privacy/Education, Rollout, Testing, Docs, Parity:** `app/admin/page.tsx` (hardware tab extensions + bulk detected import + stats), privacy copy + education expandables everywhere, full anon/auth + real/mock + cross-browser matrix, PHASE5_*/README updates, rollout checklist (dark→beta→default), monitoring stubs, verification swarm prep.

**Execution order:** A first (or A+B once facade stable), then C+D parallel. All reference this plan + prior hardware masters.

**4-Reviewer follow-up (post-impl, using VERIFICATION_SWARM_PROMPTS.md format):** Schema/RLS, Privacy/Security, Parity/Testing, UX/Docs.

---

## 7. Risks + Mitigations + Monitoring

- **Low browser accuracy on many users → frustration:** Mitigate with prominent "paste for exact" + confidence badges + education. Browser as "starting point" framing.
- **Privacy/legal backlash on WebGL strings:** Explicit "client-only until you save", detailed what/why, opt-in raw storage, legal review pre-prod.
- **Alias/catalog drift or false canonicals:** "Learn alias" + admin review queue + catalog version in all results. Wide tolerances.
- **Demo vs real drift:** Pure functions + data adapter for everything (exact prior discipline).
- **Adoption low:** Dark → beta with metrics gates. A/B copy/tests.
- **Companion scope creep:** Strictly future; MVP has no desktop code.
- **Monitoring (extend PHASE5):** Track detection attempts/success/save rate, post-detect edit rate, fallback errors (per browser), alias learning velocity, unrecognized hardware volume (admin tile). Sentry + console for client errors. Rollback: flag flip (<2min).

---

## 8. Success Metrics + A/B Ideas

**Quantitative (tracked via admin + optional opt-in telemetry):**  
- % of new/edited rigs that used detection (target >35% within 30 days of default visibility).  
- Post-detect edit rate <25% (indicates quality).  
- Report submission rate lift among users who detected vs manual only.  
- Alias learning events / week (from detected samples).  
- Unrecognized hardware volume trend (down via workbench).  
- Confidence distribution (browser avg >0.6 on Chrome cohort).  

**Qualitative:** "This was way faster than typing" + "Paste gave me exact match" feedback. Trust in "Steam Verified" badges.

**A/B Ideas (behind flag):**  
- Button label/copy ("Detect instantly" vs "Auto-fill from browser" vs "Scan hardware").  
- Banner prominence (inline vs modal on first use).  
- Default visibility (all surfaces vs checker-first).  
- "Improve accuracy" upsell strength (paste examples vs Steam link).  
- Education depth (short tooltip vs full expandable).  

**Long-term:** Correlate detected rigs with higher-quality reports (lower flag rate via catalog validation).

---

**References (must-read for implementers):** All files listed in Section 1 (exact lines), `plans/MASTER-Hardware-Validation-Implementation-Plan.md` + four `planner-*-hardware-*.md`, phase7 plans (for catalog synergy, pure fns, parity, 4-split), `supabase/schema.sql`, `lib/data.ts:716-850`, `app/admin/page.tsx:758-809`. External: WebGL debug renderer privacy notes (2026), Steam Web API docs (zero hardware), Tauri hwinfo plugin patterns.

**Ready for user approval to spawn 4 implementation agents using isolated worktrees.**

This is the most complete of the four plans — hybrid, deeply integrated, privacy-first, production-grade, fully parity-aware.
