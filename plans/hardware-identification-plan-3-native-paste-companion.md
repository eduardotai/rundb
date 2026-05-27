# Hardware Auto-Detection Implementation Plan: Native Command/Paste Helpers + Companion Detector Tool

**Project:** RunDB (ProtonDB for real PCs) — "Identify My Hardware" for My Rig population  
**Date:** 2026-05-26  
**Focus (per directive):** Highest-accuracy power-user-friendly path using **native OS commands + smart client-side paste parsers** + (phased) companion detector tool. NOT WebGL/UA hacks, NOT Steam OAuth, NOT auto-execution.  
**Status:** Planning complete after exhaustive read-only exploration of entire workspace (root, plans/, all rig surfaces, data layer, auth, admin, actions, schema). Matches style, invariants, and structure of prior swarm plans (MASTER-Hardware-Validation-Implementation-Plan.md, planner-1/2/3/4-hardware-*.md, PHASE7_MASTER_* and phase7-planner-*.md).

---

## 1. Executive Summary & Key Decisions (Unified)

**Core User Requirement:** Allow any user (authenticated including anonymous Supabase anon, or pure guest) to rapidly and accurately populate `UserPC` (cpu/gpu/ram/resolution) for "My Rig" (used in compatibility-checker, profile, submit-report-dialog, reports, predictions). Current flow is 100% manual typing + `sanitizeFullName`.

**Selected Architecture (highest accuracy, privacy, power-user friendly):**  
**Native Command/Paste Helpers + Companion Detector (MVP paste-first).**  
- Platform-specific **copy-only** command buttons (no execution, no `child_process`, no `eval`).  
- Client-only TypeScript parsers (pure, deterministic) that extract best-guess canonical-ish strings from pasted `dxdiag`, PowerShell `Get-CimInstance`, `sysctl`/`system_profiler`, `lscpu`/`lspci`, etc.  
- Live preview + "Apply to form" that feeds **existing** `UserPC` persistence (`loadMyRigAsync`/`saveMyRigAsync` + direct profile paths) and `sanitizeFullName`.  
- Reuses **HardwareAlias normalization workbench** (future `normalizeToCanonical` enhancement) + `UserPC` type exactly.  
- Optional Phase 2: tiny portable companion detector (static scripts/binaries in `/public/detectors/`) + short-lived one-time upload token flow (stateless or temp table, 10min expiry, zero persistent tracking/PII beyond hardware strings).  
- **Zero server send of raw output** in MVP. Upload path (opt-in, explicit) is Phase 2 only.

**Why this over alternatives?** Near-perfect strings (e.g., exact "AMD Ryzen 7 7800X3D", "NVIDIA GeForce RTX 4080") from the machine's own authoritative sources. Excellent for guests (localStorage only) and anon/auth parity. Reuses every proven pattern from Phase 2/4/6 plans.

**Core Invariants (identical to prior hardware plans):**
- 100% parity: anonymous Supabase users (via `user_rigs` + `profiles`), guests (LS `rundb_my_rig`), `NEXT_PUBLIC_USE_REAL_DATA=true/false`.
- Client-side parsing only for MVP (pure functions; works offline).
- Additive: sits **beside** manual inputs. Existing `saveMyRigAsync` (lib/data.ts:771), profile direct upsert, `addUserReport` flows untouched.
- Reuse: `sanitizeFullName` (lib/sanitize.ts:56), `HardwareAlias` (lib/mock-data.ts:795+ / app/admin/page.tsx:759+), `UserPC` (lib/types.ts:73), clipboard + Sonner patterns (admin:229, report-card:47), Cards/Inputs/Dialogs/tabs/accordions.
- Non-breaking. No new runtime deps. Static catalog synergy later (when Phase 6 lands).
- Defense-in-depth warnings: "Paste **output only** — never run commands from untrusted sources."

**Files Overview (MVP ~12-15 changed/added; very manageable for 4 parallel worktree agents):**
- New core: `lib/hardware-detect.ts` (commands + multi-OS parsers + types).
- New UI: `components/hardware-identify-helper.tsx` (reusable, tabbed, live preview).
- Modified: 3 rig surfaces + data.ts (light re-exports) + types.ts + admin (optional) + tests/scripts.
- Phase 2 additions: `app/actions/hardware-detect.ts` (token actions), public detector assets + build scripts.

**Phasing:** MVP (paste + copy buttons + parsers + integration in all 3 editors) → Phase 2 (companion tool scaffolding + secure optional upload token flow).

---

## 2. Options Analysis

| Approach | Accuracy | Privacy/Security | UX/Effort | Anon/Guest Parity | Reuse of Existing (Aliases, saveMyRig, sanitize) | Risk | Recommendation |
|----------|----------|------------------|-----------|-------------------|--------------------------------------------------|------|----------------|
| WebGL + navigator + UA parsing | Low (generic "Intel UHD", no exact models/RAM/res) | Good (client-only) | Excellent (zero effort) | Perfect | Low (still needs manual cleanup) | Misleading data poisons predictions | Reject for primary |
| Steam Web API / OpenID | High (for Steam users) | Medium (extra scopes, not all users) | Medium | Poor (guests/anon broken or extra friction) | Medium | Scope creep, auth coupling | Optional future enhancement only |
| Browser extension | High | Poor (install trust) | Good | Good | High | Distribution, maintenance | Out of scope |
| Full client auto-exec (e.g. hidden child_process simulation) | Medium-High | Catastrophic (injection, trust) | "Magic" | Good | High | Immediate security blocker | Reject |
| **Native cmd/paste + parsers (this plan)** | **Very High** (exact machine strings) | **Excellent** (client parse; upload opt-in Phase 2) | **Excellent** (power-user accordion + preview) | **Perfect** (LS + DB identical paths) | **Highest** (feeds UserPC + sanitize + aliases) | Parser robustness (mitigated by samples) | **Primary MVP** |
| Companion binary (Go/Rust/Tauri single-file) + optional short token upload | **Highest** | Good (short expiry token, rate-limited, no raw storage after parse) | Best (one-click "Copy for RunDB") | Perfect | Highest | Distribution/trust (mitigated by source in repo + warnings) | **Phase 2 enhancement** |

**Decision:** Pursue Native Command/Paste as MVP (highest immediate value, zero new attack surface). Companion as clean Phase 2. Matches "highest accuracy, power user friendly" directive exactly.

---

## 3. Detailed Recommended Implementation

### 3.1 Core Library (`lib/hardware-detect.ts`)
Pure, client+server safe, no side effects. Exports:
- `OSCommand` type + generators.
- `ParsedHardware` (partial `UserPC` + `confidence: number` (0-1), `source: string`, `warnings: string[]`).
- `parseHardwareOutput(rawText: string, osHint?: 'win'|'mac'|'linux'): ParsedHardware`
- Robust heuristics (regex + keyword priority; real-world dxdiag/sysctl samples in tests).

**Code sketch (abbreviated):**
```ts
// lib/hardware-detect.ts
export interface ParsedHardware {
  cpu?: string; gpu?: string; ram?: number; resolution?: string;
  confidence: number; source: string; warnings: string[];
}

export const COMMANDS = {
  windows: {
    dxdiag: `powershell -Command "dxdiag /t $env:TEMP\\rundb_dxdiag.txt; Get-Content $env:TEMP\\rundb_dxdiag.txt"`,
    powershell: `Get-CimInstance Win32_Processor | Select-Object Name; Get-CimInstance Win32_VideoController | Select Name; Get-CimInstance Win32_PhysicalMemory | Measure -Property Capacity -Sum; ...`,
    // + wmic fallbacks
  },
  macos: `sysctl -n machdep.cpu.brand_string; system_profiler SPHardwareDataType SPDisplaysDataType | grep -E 'Chip|Model|Resolution'`,
  linux: `lscpu | grep 'Model name'; lspci -v | grep -i vga; cat /proc/meminfo | grep MemTotal; xrandr | grep current || glxinfo | grep -i resolution`
};

export function generateCommand(os: 'win'|'mac'|'linux'): string { ... }

export function parseHardwareOutput(text: string, hint?: string): ParsedHardware {
  // Windows dxdiag: /Processor: (Intel|AMD).+/, Name.*(NVIDIA|AMD|Intel).+/, Memory:.*(\d+).MB, Current.*Resolution: (\d+x\d+)
  // macOS: machdep.cpu.brand_string, Chip: Apple M..., VRAM, Resolution
  // Linux: Model name:, VGA compatible, MemTotal:.*kB → GB, current resolution
  // Best-effort multi-pass; prefer exact brands; fallback heuristics
  // Post-process: run sanitizeFullName on extracted strings
  // Return highest-confidence match + warnings e.g. "Partial RAM match"
}
```

Unit tests (new `__tests__` or `lib/hardware-detect.test.ts` — even if no jest yet, provide runnable TS examples with 20+ real anonymized sample outputs).

### 3.2 Reusable UI Component
`components/hardware-identify-helper.tsx`:
- OS tabs (Windows / macOS / Linux) using existing patterns (no new deps; manual state or reuse any tab primitives).
- "Copy command" buttons → `navigator.clipboard.writeText` + `showUserSuccess` (exact pattern from admin:229).
- Large `<Textarea>` "Paste output here" (aria-labeled).
- Live `useEffect` parse → preview card (CPU: ..., GPU: ..., RAM: ..., Res: ...; confidence badge using existing `PerformanceBadge` styling or amber/emerald).
- "Apply to form" (disabled until parse) + "Clear".
- Security footer: "⚠️ Paste only the command **output**. Never paste commands from untrusted sources. This runs entirely in your browser."
- Props: `onApply: (rig: Partial<UserPC>) => void`, `compact?: boolean`.

**Insertion points (exact from reads):**
- `components/compatibility-checker.tsx`: Inside rig form Card (after resolution input row ~280, before Save buttons). Or new Accordion "Advanced: Identify from system (most accurate)".
- `components/profile-rig-editor.tsx`: Inside "My Rig" Card (~173+), parallel to inputs.
- `components/submit-report-dialog.tsx`: After hardware row (~128-143) or after driverVersion (~233) before action buttons. State bridges to RHF via `form.setValue` + sanitize.

### 3.3 Integration & Data Flow
- On Apply: sanitize fields → set parent state (or RHF values) → user reviews → existing `saveMyRigAsync` (data.ts:771) or direct profile upsert or `addUserReport`.
- Enhance `lib/data.ts` lightly: re-export parsers/commands (or new `normalizeHardwareForRig` that later calls alias lookup).
- Admin (optional MVP): New read-only note in Hardware Aliases tab (app/admin/page.tsx:759) or future "Performance Catalog" sibling (per Phase 6 plans).
- No changes to `app/actions/reports.ts` in MVP (validation additive later).

### 3.4 Companion Detector (Phase 2)
- `/public/detectors/` (new): `detect-rundb.ps1`, `detect-rundb.sh`, `README.md`.
- Build script in `scripts/` (e.g. `build-detectors.ts` or simple cross-compile Go).
- Optional secure flow: New `app/actions/hardware-detect.ts` with `generateOneTimeDetectToken()` (signed short JWT or DB row with 10min expiry + rate limit), `uploadParsedResult(token, parsed)`.
- UI: "Or run the tiny detector tool with --upload" (shows token once).
- Server validates token, returns parsed result to UI (no long-term storage of raw output).

---

## 4. Phased Rollout

**Phase 1 (MVP, 1-1.5 weeks, immediate value):**
- `lib/hardware-detect.ts` + comprehensive parser tests (real sample outputs).
- Reusable `HardwareIdentifyHelper`.
- Integration in all 3 editors + live preview + Apply.
- Copy buttons + OS tabs + warnings.
- Update `lib/types.ts` (optional `ParsedHardware`), data.ts re-exports, sanitize usage.
- Basic docs in README + inline help.
- Full anon/auth + real/mock parity matrix.
- Dark launch behind simple client flag if desired.

**Phase 2 (2-3 weeks later):**
- `/public/detectors/` + build scripts + example binaries/scripts (Go single-file preferred for portability).
- Secure short-lived token upload flow (new action, rate limits, expiry, no PII).
- Enhanced parser confidence + alias normalization bridge.
- Admin visibility (detector usage stats if logged).
- Expanded tests + contributor guide for adding parser cases.

**Phase 3 (future):** Auto-suggest canonical via aliases on Apply; integration with Phase 6 catalog validation.

---

## 5. Privacy, Accuracy, Edge Cases, Anon/Auth Parity

- **Privacy:** MVP = 100% client-side. No network. Phase 2 upload = explicit user action + short token + no raw blob storage post-parse. Never auto-uploads. Guests never touch network for this feature.
- **Accuracy:** Highest possible for non-proprietary tools (exact strings from OS APIs). Confidence scoring + warnings surface partial parses. Feeds directly into `HardwareAlias` workbench for community improvement.
- **Edge cases:** Malformed/partial output (graceful best-effort + warnings); unknown GPUs/CPUs (still apply raw, let aliases handle); mobile (hide advanced section or "Desktop recommended"); non-English locales (parsers prioritize English keys + common fallbacks); very long output (cap textarea + truncate intelligently).
- **Anon/Auth Parity (critical, per all prior plans):** 
  - Guests: LS `rundb_my_rig` path (data.ts:762 fallback) unchanged.
  - Anon (Supabase signInAnonymously()): `user_rigs` + `profiles` mirror (load/saveMyRigAsync:716-848) + profile editor direct supabase.
  - Auth OAuth: identical DB path.
  - All paths use same `saveMyRigAsync`/`clearMyRigAsync` + auth listeners (already in checker:96, game page:94, my-rig-indicator:36).
- Works fully offline after load.

---

## 6. Suggested 4-Implementer Agent Split (Worktree Isolation)

Use isolated git worktrees exactly as in MASTER-Hardware-Validation §3 and PHASE7 plans.

- **Implementer A — Detection Engine & Parsers (highest priority):** `lib/hardware-detect.ts` (full commands + 3-OS parsers + types + test samples), enhance normalizer bridge if needed, unit test suite.
- **Implementer B — Shared UI + Hot Paths (checker + submit):** `components/hardware-identify-helper.tsx`, integration into `compatibility-checker.tsx` + `submit-report-dialog.tsx` (RHF bridging), clipboard/toast patterns, accessibility.
- **Implementer C — Profile Editor + Distribution + Admin Scaffolding:** `profile-rig-editor.tsx` integration, `/public/detectors/` + README + example scripts, Phase 2 token action skeleton (`app/actions/hardware-detect.ts`), admin note, docs.
- **Implementer D — Parity, Testing, Rollout, Phase 2 Polish:** Full real/mock/anon/guest matrix (update PHASE5_*), E2E samples, success toasts/error handling, Phase 2 binary build + secure upload complete, success metrics instrumentation, README updates, verification swarm prep.

**Execution order:** A first, then B+C in parallel, D throughout. Reconcile to main via plans as source of truth.

---

## 7. Risks + Mitigations

- **Parser fragility on weird hardware/output:** Mitigated by 20+ curated real samples in tests + confidence + manual override always available + easy PRs to add cases.
- **"Command injection" user fear:** Copy-only design + prominent warnings in UI + "output only" instructions. Never execute anything.
- **Phase 6 dependency drift:** This feature is fully independent (produces better `UserPC` raw strings). Later feeds aliases/catalog. Note explicitly in code.
- **Mobile / non-desktop users:** Graceful degradation (section collapsed or desktop-only note).
- **Distribution of companion binaries:** Source-first in repo + build scripts; never auto-download unsigned exes. Users build or use provided scripts.
- **Over-promising accuracy:** UI always shows "best guess from your output" + confidence; "Review before saving".
- **Admin real-mode gaps (per Phase 7 master):** Detection works regardless (client + LS/DB save paths already branched).

---

## 8. Success Metrics

- Parser unit coverage: ≥20 real-machine sample outputs (Windows 10/11 dxdiag+PS, macOS Intel+Apple, multiple Linux distros) all produce ≥0.85 confidence on flagship hardware.
- Adoption: ≥25-35% of new My Rig saves (tracked via optional lightweight client log or admin count) use "Identify" flow within 30 days of launch.
- Zero regressions: All existing save paths (profile, checker, submit) + auth state listeners + clearMyRig continue to function identically.
- User sentiment: Positive feedback on accuracy ("finally exact names"); low support tickets on parse failures.
- Security: 0 incidents related to pasted content or token flow (audited in Phase 2).
- Parity: 100% matrix pass (guest/anon/auth × real/mock) documented in updated PHASE5 checklist.
- Maintainability: New detector cases added via PRs in <15 min.

**Next Immediate Actions:** Present this plan for approval. On approval, spawn 4 implementation agents via worktrees with subagent prompts containing excerpts from this plan + relevant prior hardware MASTER/planners. Follow verification swarm discipline.

**References:** Direct inspection of lib/data.ts:716-848 (My Rig async), lib/types.ts:73 (UserPC), lib/mock-data.ts:795-844 (aliases + CRUD), app/admin/page.tsx:759-809 (workbench), components/submit-report-dialog.tsx:127-143 & 233 (hardware insertion), compatibility-checker.tsx:250-287 & 96 (form + listeners), profile-rig-editor.tsx:173-199 (editor), lib/sanitize.ts:56, clipboard usage patterns, all Phase 6/7 plans.

This plan is self-contained, actionable, and production-minded.
