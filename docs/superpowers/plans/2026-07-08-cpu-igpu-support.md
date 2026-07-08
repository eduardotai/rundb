# CPU iGPU Support Implementation Plan

> **For agentic workers:** Implemented end-to-end in the same session (always-approve goal mode).

**Goal:** Let iGPU-only users set a valid GPU from their CPU’s integrated graphics without invasive UI.

**Architecture:** Structured `hasIgpu` / `igpuCanonical` on CPU catalog entries (enriched at merge time), first-class iGPU GPU rows, pure `lib/cpu-igpu.ts` resolve helpers, GPU combobox pin + save-time one-click dialog on all rig pickers.

**Tech Stack:** Next.js client components, existing hardware catalog, react-hook-form surfaces, node:test.

## Delivered

- [x] Design: `docs/superpowers/specs/2026-07-08-cpu-igpu-support-design.md`
- [x] Types + iGPU GPU catalog rows + enrichment
- [x] `lib/cpu-igpu.ts` + tests
- [x] Mapper / importer / optional SQL columns
- [x] `HardwareCombobox` `relatedCpu` pin
- [x] `IgpuSuggestDialog` + profile / checker / submit / edit wires

## Verify

```bash
npx tsx --test lib/cpu-igpu.test.ts
npm test
```
