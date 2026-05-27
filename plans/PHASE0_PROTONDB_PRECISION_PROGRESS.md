# Phase 0 Complete — ProtonDB-Style Hardware Precision (Quick Wins)

**Date:** 2026 (executed in order per user request)
**Status:** Phase 0 shipped and verified (build + tsc clean)

## What Was Done (in strict order)

### 1. Library Enhancement (lib/hardware-detector.ts)
- Added strong `parseInxi()` function — the highest-signal Linux path used by ProtonDB.
  - Extracts: CPU, GPU, RAM, **driverVersion**, **kernel**, **distro**.
  - Stashes rich details in `raw` (inxiDriver, inxiKernel, etc.) for future use / alias learning.
- Updated main `parsePaste()` detection order to recognize inxi output early.
- Extended `DetectedHardware` type (additive) with `driverVersion?`, `kernel?`, `distro?`.
- Updated result assembly + confidence paths.
- Added inxi test sample + self-test assertion.

### 2. Paste Modal Upgrade (components/paste-hardware-modal.tsx)
- Removed the weak duplicate inline parser.
- Now imports and uses the real `parsePaste()` from the detector (single source of truth).
- **Linux tab is now ProtonDB-grade**:
  - Primary command: `inxi -Fxxxz` (with install hint).
  - Strong secondary guidance for `vulkaninfo`.
- Updated copy, placeholder, and dialog description to reference the ProtonDB approach.
- This alone is a massive UX + data quality improvement for Linux users.

### 3. Submit Flow Integration (components/submit-report-dialog.tsx)
- Wired the full detection stack (previously only present in checker + profile editor):
  - `HardwareDetectButton` next to both CPU and GPU labels (browser + paste delegation).
  - `DetectedHardwareBanner` with Apply / Refine / Dismiss / Try Paste.
  - `PasteHardwareModal` wired at the bottom.
  - New quick actions: "Use my saved rig" + "Paste system info (most accurate)".
- When detection provides `driverVersion`, it automatically populates the existing Driver Version field in the report form (nice free win).
- Consistent state machine and handler patterns with the other surfaces.

### Verification
- `npm run build` → clean success.
- `npx tsc --noEmit` → zero errors.
- Parser self-test updated with inxi case.

## Current State vs ProtonDB

**Now much closer on the paste side** (especially Linux):
- Windows: dxdiag remains excellent.
- Linux: inxi is now the prominently recommended + well-parsed path.
- Cross-platform: Steam System Information is well supported.

**Still missing for full parity** (these are Phase 1+):
- Multi-device / "My Devices" management (users can have named rigs like ProtonDB).
- First-class storage + display of driverVersion / kernel / distro on reports and user_rigs.
- "Use my saved rig" prefill on dialog open (easy follow-up).
- Richer surfacing of the new fields in ReportCard / game pages / admin.

## Recommended Phase 1 Scope (next in order)

1. **Data model & persistence**
   - Start writing `driverVersion`, `kernel`, `distro` (when present) into reports via the submit action / RPC.
   - Optionally add the same optional columns to `user_rigs`.
   - Update `addUserReport` / `submit_report` RPC if needed.

2. **UI surfacing**
   - Show driver version (and optionally kernel/distro) on ReportCard when available.
   - Small "Rig details" disclosure on reports.

3. **Submit dialog polish**
   - Auto-load saved rig on open (with a subtle "Loaded from your saved rig" badge).
   - Better handling of detection confidence in the banner for the submit context.

4. **Documentation**
   - Add a small "How hardware detection works" note (or expand the paste modal footer).
   - Update README with the new inxi recommendation for Linux contributors.

This Phase 0 work is fully additive, privacy-preserving, and reuses every existing primitive. Linux users now have a dramatically better path to precise reports.

## Phase 1 Status (Completed in this session)

All Phase 1 items executed in order:

- Data model + RPC extended for kernel + distro (driver_version already existed).
- Persistence layer (data.ts) now round-trips the rich fields on save/load for both reports and user_rigs.
- ReportCard now surfaces kernel/distro when present.
- Submit dialog auto-loads saved rig on open + forwards richer fields from detection.
- Documentation updated (README + modal footer).

Full ProtonDB-style precision on paste (especially Linux via inxi) is now live in the product.

---

**All phases completed in order (Phase 0 → 1 → 2 → 3) during this session.**

## Final Status

- **Phase 0 (Quick Wins)**: inxi parser + modal upgrade + submit wiring — Done
- **Phase 1 (Precision + Rich Fields)**: Schema, persistence, surfacing on ReportCard, auto-load, docs — Done
- **Phase 2 (Multi-Device)**: Schema columns + full data layer (load/save/delete devices) + working selector in Submit dialog + mock support — Done (usable multi-rig experience shipped)
- **Phase 3 (Companion Prep)**: Documented extension point + companionStub + bridge hint — Done

The implementation now gives RunDB the core of what makes ProtonDB hardware data "so precise":
- Best-in-class Linux paste via `inxi` (same as ProtonDB)
- Rich metadata (driver, kernel, distro) captured and surfaced
- Multiple named devices per user (the "My Devices" experience)
- Fully client-side, privacy-first, additive to manual entry

Future work (Tauri companion for zero-paste highest accuracy) is stubbed and documented.
