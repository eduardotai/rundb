# CPU Integrated Graphics (iGPU) Support — Design

**Date:** 2026-07-08  
**Status:** Approved (Approach A, always-approve end-to-end)  
**Goal:** iGPU-only users can set a valid rig GPU from their CPU’s integrated graphics, without invasive UI.

## Problem

RunDB’s hardware catalog and GPU selectors are oriented around discrete GPUs. Users with only integrated graphics (APUs, Intel non-F desktop chips, many laptops) cannot easily pick a GPU for My Rig / compatibility / reports. CPU entries sometimes mention iGPUs in free-text notes, but there is no structured CPU→iGPU link and almost no iGPU GPU catalog rows.

## Goals

1. Identify when a selected CPU has integrated graphics.
2. Offer a **non-invasive** suggestion: only when the user tries to save/submit with a CPU that has iGPU and an **empty** GPU field.
3. One-click fill: “This CPU includes *X*. Use it as GPU?” → Use / Pick manually.
4. Pin the related iGPU at the top of the GPU selector when the paired CPU is known.
5. Apply on **all** rig GPU pickers (profile My Rig, Compatibility checker, submit report, edit report).
6. No user_rigs / report schema change: store the iGPU as a normal GPU canonical string.

## Non-goals (v1)

- Dual-GPU “prefer iGPU while dGPU is set” prompts.
- Auto-detecting “no discrete GPU installed” beyond empty GPU field.
- Perfect silicon-level accuracy for every OEM laptop SKU rename.
- Mandatory DB migration for production (static catalog works offline; optional columns for live overrides).

## Approach A (selected)

### Data model

Extend `HardwareCatalogEntry` (CPU usage):

| Field | Type | Meaning |
|--------|------|--------|
| `hasIgpu` | `boolean` (optional) | Explicit yes/no when known |
| `igpuCanonical` | `string` (optional) | Canonical GPU catalog name when `hasIgpu === true` |

Rules:

- `hasIgpu === true` ⇒ `igpuCanonical` must reference an existing GPU catalog entry.
- `hasIgpu === false` ⇒ omit `igpuCanonical`.
- Unknown ⇒ omit both (no pin, no save nudge).

Add first-class **GPU** rows for integrated chips (Intel UHD/Iris/Arc iGPU, AMD Vega / Radeon 780M / generic AM5 Radeon Graphics) with relative `perfIndex`, `series` like `Intel iGPU` / `AMD iGPU`, and notes marking them integrated.

### Coverage

Every CPU in the merged static catalog receives an explicit decision via:

1. Structured fields already on the entry (dataset/curated/DB), **or**
2. Deterministic enrichment applied when building the merged catalog (`inferCpuIgpuFields`), so F/KF, APUs, AM5, and common Intel gens are covered without hand-editing hundreds of objects.

Explicit entry fields always win over inference.

### Lookup API

Pure helper module `lib/cpu-igpu.ts`:

- `inferCpuIgpuFields(canonical, vendor)` — deterministic mapping rules + explicit overrides.
- `enrichEntryWithIgpu(entry)` — no-op for non-CPU; fills missing hasIgpu/igpuCanonical.
- `resolveIgpuForCpu(cpu, entries)` — find CPU entry, return suggested iGPU canonical or “no iGPU”.

### UX

**GPU combobox** (`relatedCpu?: string`):

- When `componentType === 'gpu'` and `relatedCpu` resolves to an iGPU, pin that entry under heading **“From your CPU”** above normal catalog matches.
- Selecting it sets GPU to the iGPU canonical like any other GPU.
- No banners while typing.

**Save / submit gate:**

- Trigger only if GPU is empty/missing after sanitize **and** CPU resolves to `hasIgpu` with `igpuCanonical`.
- Soft dialog: explain the CPU includes that iGPU; **Use integrated graphics** fills GPU and continues the save path; **Pick manually** closes dialog and focuses GPU selector.
- If GPU empty and CPU has no iGPU → existing “CPU and GPU are required” error unchanged.
- If GPU already filled → never interrupt.

### Surfaces

| Surface | Change |
|---------|--------|
| `profile-rig-editor` | `relatedCpu={rig.cpu}`, save gate dialog |
| `compatibility-checker` | `relatedCpu={cpu}`, save gate dialog |
| `submit-report-dialog` | `relatedCpu` from form CPU, submit gate |
| `edit-report-dialog` | same as submit |

### Persistence / DB

- Rig and reports continue to store `gpu` as string (iGPU canonical).
- Optional: `hardware_catalog.has_igpu`, `igpu_canonical` columns + mapper support so live DB can override static enrichment.
- Similarity / matching treat iGPUs as normal GPUs.

### Testing

- Unit tests for inference (F-series no iGPU, 5600G→Vega 7, 8700G→780M, 7800X3D→Radeon Graphics, i5-12400→UHD 730, i5-12400F→none).
- Unit tests for resolve with structured fields overriding inference.
- Manual: empty GPU + APU save → dialog → Use → GPU filled and save succeeds; GPU combobox shows pinned iGPU.

## Success criteria

1. iGPU-only user with Ryzen 5 5600G can save My Rig with GPU `AMD Radeon Vega 7 Graphics` via one click or combobox pin.
2. Discrete-GPU user with filled GPU never sees the dialog.
3. No new required fields on user_rigs/reports.
4. Catalog consumers keep working; perfIndex present on iGPU GPU rows for future similarity.
