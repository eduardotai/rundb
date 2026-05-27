# PLAN: Browser-Native Hardware Identification ("Identify My Hardware") for RunDB

**Project:** RunDB (ProtonDB for real PCs) — Add zero-install, opt-in, browser-native auto-detection of CPU/GPU/RAM/resolution to populate "My Rig" (used by CompatibilityChecker, Profile, SubmitReportDialog, predictions, ReportCard similarity).  
**Date:** 2026-05-26  
**Perspective:** Software architect (read-only deep exploration of entire workspace via tools).  
**Status:** Complete, actionable implementation plan. Matches style, invariants, and structure of existing swarm plans (MASTER-Hardware-Validation-Implementation-Plan.md + planner-1/2/3/4-*.md).

### Executive Summary + Key Decisions

**Goal (verbatim from task):** Enable users to auto-populate CPU/GPU/RAM/resolution for "My Rig" via browser-native detection. Maximum zero-install UX. Deep integration with existing rig persistence (user_rigs primary + profiles fallback for logged-in incl. anon; localStorage guest fallback only), HardwareAlias system, sanitizeFullName, and future hardware-performance-catalog + normalize-hardware (per MASTER plan).

**Core Architecture Decision:** Pure client-side `lib/detect-hardware-browser.ts` exporting `detectHardwareBrowser(): Promise<Partial<UserPC> & {confidence: number; raw: any; method: string}>`. No server calls, no new DB columns, no schema changes. Detection is **opt-in only** (explicit button press). Raw data never persisted or sent except what user explicitly saves via existing `saveMyRigAsync` / form paths. Always manual override + "Refine in editor".

**Key Decisions (unified across exploration):**
- **Browser APIs (priority order for accuracy):** 1. `WEBGL_debug_renderer_info` + `<canvas>.getContext('webgl')` (highest precision for discrete GPUs: "NVIDIA GeForce RTX 4070 SUPER/PCIe/SSE2" strings). 2. `navigator.deviceMemory` (RAM approx, Chrome/Edge only). 3. `navigator.hardwareConcurrency` + lightweight timed micro-benchmark (CPU core count + rough tier). 4. User-Agent Client Hints (`navigator.userAgentData.getHighEntropyValues`) for model/OS/arch. 5. `screen.width/height + colorDepth`; limited refresh via `matchMedia` or Screen Orientation API.
- **Normalization pipeline:** Raw strings → `sanitizeFullName` → optional client-side alias lookup (reuse `loadHardwareAliases` + simple matcher; synergy with planned `lib/normalize-hardware.ts:getCanonicalHardware` and `getHardwarePerf` from MASTER/planner-1) → user confirmation → save. Detected canonical feeds directly into existing `extractGpuSeries`/`getCpuTier`/`calculateSimilarity` and future catalog validation.
- **3 exact entry points (no more):** `compatibility-checker.tsx` (My Rig form), `profile-rig-editor.tsx` (profiles table direct), `submit-report-dialog.tsx` (prefill before RHF submit). Shared small `HardwareDetectButton` + result preview card.
- **UX invariants:** Non-blocking. Shows "Detected: [canonical or raw] (source: WebGL) — 82% confidence". Buttons: "Use these values", "Refine manually", expandable "Raw details + limitations". Privacy disclosure inline. Educational tone ("Best effort; laptops/iGPUs/Safari may be approximate").
- **Parity & flags:** 100% anon/auth + `NEXT_PUBLIC_USE_REAL_DATA` parity (detection never touches adapter; save paths already do). Pure + offline-safe.
- **Phasing:** MVP (browser detector + 3 integrations + basic parser + disclosure). Phase 2 (alias/catalog composition + confidence UI polish + test mocks). Phase 3 (micro-benchmark tuning, refresh rate, optional server canonical endpoint).
- **No breaking changes:** Existing manual inputs, auth listeners (data.ts:716-849, checker:58-126, game page:80-108), `useMyRig()`, `sanitizeFullName` (lib/sanitize.ts:56-67), HardwareAlias CRUD (admin ~759-809 + mock-data:795-844) untouched.

**Files changed/added (minimal, ~8-10 total):** 1 new core util + targeted additions to 3 components + types + optional data re-export + new plan doc.

**Invariants enforced (matching MASTER + planners):** Additive (no replacement of manual entry), defense-in-depth ready (composes with future `validateHardwarePerformance`), non-punitive/educational, static/pure where possible, full parity matrix.

### Options Analysis

| Approach | Pros | Cons | Why Rejected / Selected |
|----------|------|------|-------------------------|
| **Browser-native (WebGL + navigator.*) — RECOMMENDED** | Zero-install, instant, private (opt-in, no fingerprint storage), works offline/anon, reuses existing alias/normalize patterns, low risk | Browser variance (Safari/Firefox weaker WebGL, no deviceMemory), spoofable, iGPU/laptop underreporting | **Selected.** Matches explicit task focus. Matches codebase philosophy (pure client helpers like calculateSimilarity). |
| Native app / Steamworks / Electron wrapper | Highest accuracy (dxdiag, WMI, Vulkan) | Massive install barrier, kills UX for "ProtonDB for real PCs", platform skew, maintenance hell | High friction contradicts "maximum zero-install UX". |
| Third-party lib (e.g., platform-detect, fingerprintjs) | Quick start | Bloat, privacy risk (cross-site tracking), license, version drift | Violates privacy-first + zero-dependency culture (see sanitize, utils). |
| Server-only (UA parsing + optional client hints endpoint) | Centralized | Requires network on every detect, breaks guests/offline, less precise GPU strings | Detection is read-only client UX; server only for future canonical if needed. |
| Hybrid (browser + optional native fallback) | Best of both | Complexity, branching UX, still needs install path | Overkill for MVP; browser-first per goal. |

**Selected path wins** on UX, privacy, parity, and composability with existing HardwareAlias + planned normalize-hardware (MASTER §2, planner-1 §2, planner-3 §1).

### Detailed Recommended Implementation

#### 1. New Core: `lib/detect-hardware-browser.ts`
Pure client module. No side effects beyond one-time canvas/context creation (disposable).

Code sketch (key parts):
```ts
// lib/detect-hardware-browser.ts
export interface HardwareDetectionResult {
  cpu?: string;
  gpu?: string;
  ram?: number;
  resolution?: string;
  confidence: number; // 0-1 aggregate
  raw: {
    webglRenderer?: string;
    webglVendor?: string;
    deviceMemory?: number;
    hardwareConcurrency?: number;
    uaMobile?: boolean;
    screen?: { w: number; h: number; dpr: number };
    benchmarkMs?: number;
  };
  method: 'webgl-primary' | 'partial-ua' | 'fallback';
  limitations: string[];
}

export async function detectHardwareBrowser(): Promise<HardwareDetectionResult> {
  const result: HardwareDetectionResult = { confidence: 0, raw: {}, method: 'fallback', limitations: [] };
  // 1. WebGL (highest value)
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (ext && gl) {
      const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
      const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string;
      if (renderer) {
        result.gpu = sanitizeFullName(renderer.replace(/\(.*?\)/g, '').trim()); // clean PCIe/SSE2
        result.raw.webglRenderer = renderer;
        result.raw.webglVendor = vendor;
        result.confidence = Math.max(result.confidence, 0.82);
        result.method = 'webgl-primary';
      }
    }
  } catch (e) { result.limitations.push('WebGL unavailable or blocked'); }

  // 2. RAM + cores + light benchmark
  const mem = (navigator as any).deviceMemory;
  if (typeof mem === 'number') { result.ram = Math.min(128, Math.max(4, Math.round(mem))); result.confidence += 0.08; }
  const cores = navigator.hardwareConcurrency;
  if (cores) {
    result.raw.hardwareConcurrency = cores;
    // TODO: optional 8-12k crypto.subtle or ImageData timing micro-bench → rough tier string
    if (!result.cpu) result.cpu = `${cores}-core CPU (detected)`;
  }

  // 3. UA-CH (secure context only)
  if ('userAgentData' in navigator) {
    try {
      const ua = await (navigator as any).userAgentData.getHighEntropyValues(['model', 'platform', 'architecture']);
      // light mapping e.g. model → cpu hint
    } catch {}
  }

  // 4. Screen
  result.resolution = `${screen.width}x${screen.height}`;
  result.raw.screen = { w: screen.width, h: screen.height, dpr: window.devicePixelRatio };

  // 5. Post-process: alias attempt (client-safe)
  // if (result.gpu) { const aliases = await safeLoadAliasesForClient(); const canon = matchAlias(result.gpu, aliases); if (canon) result.gpu = canon; }

  result.limitations.push('Browser-reported values; spoofable; iGPUs/laptops often report integrated GPUs');
  return result;
}
```
- Export helpers: `getConfidenceLabel(r: HardwareDetectionResult)`, `formatDetectedSummary`.
- Graceful degradation everywhere. No persistent storage of `raw`.

**Integration with normalization (Phase 1.5/2):** Import `loadHardwareAliases` (mock path) or future async alias reader. Use simple `rawString` prefix/substring match against aliases (reuse logic from mock-data:795+). Feed to planned `normalize-hardware.ts`.

#### 2. UI Components (reuse design system exactly)
- New small reusable: `components/hardware-detect-button.tsx` (or inline in 3 places for simplicity). Props: `onDetected(result)`, `disabled`, variant.
- Preview card (amber/emerald tokens per planner-3): "Detected via WebGL: NVIDIA GeForce RTX 4070 SUPER — 85% confidence. Source: browser renderer string."
- Buttons: "Use these values" (sets form state / calls save), "Refine in editor", "Why this?" (disclosure popover with limitations + privacy text).
- Privacy disclosure (always visible near button): "We only read what your browser publicly exposes (WebGL renderer, core count, approximate RAM). Nothing is sent to servers until you explicitly save."

**Exact insertion points (from reads):**
- `compatibility-checker.tsx:289` (after Save/Clear buttons row, before game selector) — add detect row + state sync to cpu/gpu/ram/resolution.
- `profile-rig-editor.tsx:233` (near Save button) — update `RigFields` + `updateField` on detect.
- `submit-report-dialog.tsx:234` (after driver row, before action buttons — mirrors planner-2/3 validation banner placement) — prefill form via `form.setValue`.

All three already have auth listeners + loadMyRigAsync patterns; detection augments form state only.

#### 3. Types (`lib/types.ts`)
Add:
```ts
export interface HardwareDetectionResult {
  // as above
}
```
(Or keep internal to detector + surface only Partial<UserPC> + meta.)

#### 4. Data Layer / Re-exports (`lib/data.ts`)
Optional (MVP):
```ts
export { detectHardwareBrowser } from './detect-hardware-browser';
// Later: export { getCanonicalHardware } from './normalize-hardware' (when exists)
```
Keep `loadMyRigAsync` etc. unchanged (detection feeds them).

#### 5. Admin / Future
- Note in admin Hardware Normalization Workbench (app/admin/page.tsx:762) that detected strings will become high-value raw inputs for alias curation.
- No immediate changes to alias CRUD.

#### 6. Other
- `lib/toast.ts` / Sonner: optional success/info on "Values applied".
- No changes to `app/actions/*`, supabase schema, RLS, or server paths (pure client).
- Testing harness: dev-only `window.__RUNDB_MOCK_WEBGL_RENDERER = '...' ` override + manual cross-browser checklist.

### Phased Rollout (MVP → Enhancements)

**MVP (immediate, low risk, 1 implementer focus):**
- Detector util + parsers + confidence + raw + limitations.
- 3 UI integrations + shared preview + disclosure.
- Basic alias heuristic (client).
- Full anon/auth/USE_REAL parity (already free via existing paths).
- Manual testing matrix (Chrome/Edge/Firefox/Safari, desktop + laptop, discrete vs iGPU).

**Phase 2 (post-MVP, composes with hardware catalog):**
- Wire detected output through `getCanonicalHardware` / normalize-hardware + catalog perfIndex (once those land).
- Enhanced micro-benchmark + refresh rate.
- "Detected rig health" teaser using future validation.
- Unit tests for detector (mock canvas/context).

**Phase 3 (future):**
- Optional lightweight server canonical endpoint (for very ambiguous strings).
- Admin import of common detected raws as seed aliases.
- Metrics (detection usage vs manual, success rate by browser).

**USE_REAL flag discipline:** Detector never branches; only save/load paths do (data.ts:716+).

### Privacy, Accuracy, Edge Cases, Anon/Auth Parity Notes

- **Privacy:** Explicit opt-in button only. Clear disclosure text. `raw` discarded after "Use" or dialog close. No cookies, no localStorage fingerprint, no cross-site. Matches sanitize ethos.
- **Accuracy:** WebGL excellent for NVIDIA/AMD discrete (exact model strings common). Weaker on Intel iGPUs, laptops (power limits), macOS, mobile (task excludes mobile focus but graceful). Confidence explicitly surfaced. "Refine always available."
- **Edge cases:** WebGL blocked (privacy extensions) → fallback + message. Safari (limited debug info) → lower confidence. Spoofing (user can always edit). Multiple GPUs (picks primary renderer). Anon guests: full flow via LS fallback.
- **Anon/Auth parity:** Identical to existing rig flows (data.ts:716-849 load/save/clearAsync + profile editor direct Supabase). Detection client-only; persistence unchanged. Guests never touch DB.
- **Fingerprinting:** Deliberately narrow + ephemeral. Not a full fingerprint.

### Suggested Split for 4 Implementer Agents (worktree isolation)

**Implementer A — Detector Core (unblocks all):** `lib/detect-hardware-browser.ts` (full impl + parsers + confidence logic + micro-bench + safe alias matcher stub) + types + unit harness + docs header.

**Implementer B — Checker + Profile Editor Surfaces:** `components/compatibility-checker.tsx`, `components/profile-rig-editor.tsx`, new/shared `HardwareDetectButton` + preview card, state wiring + auth listener compatibility.

**Implementer C — Submit + Polish + Privacy:** `components/submit-report-dialog.tsx` (prefill + disclosure), global education strings, toast patterns, limitations UI, cross-component consistency pass.

**Implementer D — Integration, Parity, Testing, Rollout, Docs:** Full parity matrix (anon/real/mock), manual + scripted browser tests, update README/AGENTS, admin workbench note, PHASE5 checklist additions, success metrics instrumentation stub, final review of composition with future normalize-hardware.

Use isolated worktrees. A first, then parallel B/C with D coordinating.

### Risks + Mitigations

- **Browser variance / low confidence on some users:** Mitigated by explicit confidence + limitations + "always editable" + fallback messages. Dark launch optional.
- **Spoofing / malicious data:** Same as manual entry today; future catalog validation catches absurd claims server-side.
- **iGPU / laptop misreports:** Documented in disclosure + "Refine" path. Catalog will have wide bands (per MASTER).
- **Adoption:** Educational button label + immediate visible result preview. Measure via future analytics.
- **Drift with aliases/catalog:** Detector outputs raw + suggested canonical; aliases remain single source of truth (admin-controlled).

### Success Metrics

- Detection button usage rate (vs manual entry) >15% within 2 weeks of soft launch.
- Average confidence of used detections >0.65.
- Reduction in "unknown GPU" style strings in new reports (tracked via admin).
- Zero privacy incidents or support tickets about unexpected data collection.
- Full parity matrix passes (anon/auth, real/mock, 4 major browsers).
- "Refine manually" used on <30% of detections (indicates good default quality).

**References (absolute, from tool exploration):** All specified files read in full or targeted sections (e.g. data.ts:670-850 exact my-rig async, mock-data:379-397 + 418-445 + 551-592 pure helpers + aliases, admin:762-809 workbench, components exact insertion lines, plans/MASTER + 4 planners full structure + normalize-hardware references, schema user_rigs/profiles, sanitize.ts:56, etc.). No existing detection/WebGL code in app/.

**Next:** User approval → spawn 4 worktree implementers with this plan + relevant excerpts.

---

**PLAN COMPLETE: Browser-Native Hardware Identification**

<subagent_meta>id=019e676a-983f-7c61-bd9c-31ba35511226, type=plan, tool_calls=72, turns=1, duration_ms=310043</subagent_meta>