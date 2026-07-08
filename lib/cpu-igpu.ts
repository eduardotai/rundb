/**
 * CPU ↔ integrated graphics (iGPU) resolution.
 *
 * Structured catalog fields (`hasIgpu`, `igpuCanonical`) win when present.
 * Missing fields are filled by deterministic inference so every catalog CPU
 * gets an explicit yes/no for save-nudge + GPU combobox pinning.
 */

import type { HardwareCatalogEntry } from './types';

export type CpuIgpuResolution =
  | { hasIgpu: true; igpuCanonical: string }
  | { hasIgpu: false };

/** Canonical iGPU GPU names used across catalog + inference. */
export const IGPU_CANONICAL = {
  UHD_630: 'Intel UHD Graphics 630',
  UHD_730: 'Intel UHD Graphics 730',
  UHD_750: 'Intel UHD Graphics 750',
  UHD_770: 'Intel UHD Graphics 770',
  IRIS_XE: 'Intel Iris Xe Graphics',
  ARC_IGPU: 'Intel Arc Graphics',
  RADEON_GRAPHICS: 'AMD Radeon Graphics',
  VEGA_7: 'AMD Radeon Vega 7 Graphics',
  VEGA_8: 'AMD Radeon Vega 8 Graphics',
  VEGA_11: 'AMD Radeon Vega 11 Graphics',
  Radeon_760M: 'AMD Radeon 760M',
  Radeon_780M: 'AMD Radeon 780M',
  Radeon_610M: 'AMD Radeon 610M',
} as const;

/** Explicit overrides for SKUs that heuristics get wrong or need a precise iGPU name. */
const EXPLICIT_CPU_IGPU: Record<string, CpuIgpuResolution> = {
  // AMD APUs — precise iGPU product names
  'AMD Ryzen 3 3200G': { hasIgpu: true, igpuCanonical: IGPU_CANONICAL.VEGA_8 },
  'AMD Ryzen 5 3400G': { hasIgpu: true, igpuCanonical: IGPU_CANONICAL.VEGA_11 },
  'AMD Ryzen 5 5600G': { hasIgpu: true, igpuCanonical: IGPU_CANONICAL.VEGA_7 },
  'AMD Ryzen 5 5600GT': { hasIgpu: true, igpuCanonical: IGPU_CANONICAL.VEGA_7 },
  'AMD Ryzen 5 5500GT': { hasIgpu: true, igpuCanonical: IGPU_CANONICAL.VEGA_7 },
  'AMD Ryzen 7 5700G': { hasIgpu: true, igpuCanonical: IGPU_CANONICAL.VEGA_8 },
  'AMD Ryzen 5 8600G': { hasIgpu: true, igpuCanonical: IGPU_CANONICAL.Radeon_760M },
  'AMD Ryzen 7 8700G': { hasIgpu: true, igpuCanonical: IGPU_CANONICAL.Radeon_780M },
  'AMD Ryzen 5 7520U': { hasIgpu: true, igpuCanonical: IGPU_CANONICAL.Radeon_610M },
};
function yes(igpuCanonical: string): CpuIgpuResolution {
  return { hasIgpu: true, igpuCanonical };
}

function no(): CpuIgpuResolution {
  return { hasIgpu: false };
}

/**
 * Infer iGPU presence + canonical GPU name from a CPU marketing name.
 * Conservative: when unsure, returns hasIgpu: false (no nudge).
 */
export function inferCpuIgpuFields(
  canonical: string,
  vendor?: HardwareCatalogEntry['vendor'] | string
): CpuIgpuResolution {
  const name = (canonical || '').trim();
  if (!name) return no();

  const explicit = EXPLICIT_CPU_IGPU[name];
  if (explicit) return explicit;

  const lower = name.toLowerCase();
  const v = (vendor || detectVendor(name)).toString().toUpperCase();

  if (v === 'INTEL' || lower.includes('intel')) {
    return inferIntelIgpu(name);
  }
  if (v === 'AMD' || lower.includes('ryzen') || lower.includes('amd')) {
    return inferAmdIgpu(name);
  }

  return no();
}

function detectVendor(name: string): string {
  const l = name.toLowerCase();
  if (l.includes('intel') || l.includes('core ')) return 'Intel';
  if (l.includes('amd') || l.includes('ryzen')) return 'AMD';
  return 'Other';
}

function inferIntelIgpu(name: string): CpuIgpuResolution {
  // F / KF = no iGPU (desktop discrete-only SKUs)
  // Match model suffix: ...-12400F, ...-14600KF, ...F at end of model token
  if (/\b\d{3,5}KF\b/i.test(name) || /\b\d{3,5}F\b/i.test(name)) {
    // Avoid matching non-SKU words; Core Ultra doesn't use F the same way
    return no();
  }
  // Also plain "...F" / "...KF" at end (e.g. i5-9400F)
  if (/[0-9]KF\s*$/i.test(name) || /[0-9]F\s*$/i.test(name)) {
    return no();
  }

  // Core Ultra desktop/mobile — Arc iGPU
  if (/core\s+ultra/i.test(name)) {
    return yes(IGPU_CANONICAL.ARC_IGPU);
  }

  // Extract generation-ish model number (e.g. 14700, 12400, 9900)
  const modelMatch = name.match(/\b([iI]\d[-\s]?)?(\d{4,5})([A-Z]*)\b/);
  const modelNum = modelMatch ? parseInt(modelMatch[2], 10) : NaN;
  const suffix = (modelMatch?.[3] || '').toUpperCase();

  if (suffix === 'F' || suffix === 'KF' || suffix.endsWith('F')) {
    // KF already handled; plain F
    if (suffix === 'F' || suffix === 'KF' || /^K?F/.test(suffix)) {
      return no();
    }
  }

  if (!Number.isFinite(modelNum)) {
    // Generic Intel with graphics wording in notes handled elsewhere
    return no();
  }

  // Gen bands by leading digits of 4-digit models (12400 → 12th gen)
  const gen = modelNum >= 10000 ? Math.floor(modelNum / 1000) : Math.floor(modelNum / 100);

  // 12th–14th gen (Alder/Raptor/Refresh)
  if (gen >= 12 && gen <= 14) {
    if (suffix.includes('K')) return yes(IGPU_CANONICAL.UHD_770);
    // i3 / lower non-K → 730; higher non-K often 770 but 730 is safer mid default for i5 non-K
    if (/i3/i.test(name) || modelNum % 1000 < 500) return yes(IGPU_CANONICAL.UHD_730);
    if (/i5/i.test(name)) return yes(IGPU_CANONICAL.UHD_730);
    return yes(IGPU_CANONICAL.UHD_770);
  }

  // 11th gen
  if (gen === 11) {
    return yes(IGPU_CANONICAL.UHD_750);
  }

  // 8–10th gen
  if (gen >= 8 && gen <= 10) {
    return yes(IGPU_CANONICAL.UHD_630);
  }

  // 6–7th gen still UHD/HD era — map to 630 family for catalog simplicity
  if (gen >= 6 && gen <= 7) {
    return yes(IGPU_CANONICAL.UHD_630);
  }

  return no();
}

function inferAmdIgpu(name: string): CpuIgpuResolution {
  // Explicit APU letter suffixes: G, GE, GT (not to be confused with nothing)
  // e.g. 5600G, 5700G, 8600G, 3400G
  const apu = name.match(/\b(\d{4})(G|GE|GT)\b/i);
  if (apu) {
    const num = parseInt(apu[1], 10);
    const tag = apu[2].toUpperCase();

    // Zen 4 Phoenix APUs
    if (num >= 8000 && num < 9000) {
      if (num >= 8700) return yes(IGPU_CANONICAL.Radeon_780M);
      return yes(IGPU_CANONICAL.Radeon_760M);
    }
    // Zen 3 Cezanne / refresh
    if (num >= 5000 && num < 6000) {
      if (num >= 5700) return yes(IGPU_CANONICAL.VEGA_8);
      return yes(IGPU_CANONICAL.VEGA_7);
    }
    // Zen+ Picasso (3000G) and Raven Ridge (2000G)
    if (num >= 2000 && num < 4000) {
      if (num >= 3400) return yes(IGPU_CANONICAL.VEGA_11);
      if (num >= 2400) return yes(IGPU_CANONICAL.VEGA_11);
      return yes(IGPU_CANONICAL.VEGA_8);
    }
    // Fallback for other G-series
    if (tag === 'G' || tag === 'GE' || tag === 'GT') {
      return yes(IGPU_CANONICAL.RADEON_GRAPHICS);
    }
  }

  // AM5 desktop (Raphael / Granite Ridge / etc.): all have 2CU Radeon Graphics
  // Model numbers 7000–9999 family (7600, 7800X3D, 9700X, 9950X3D)
  const ryzenModel = name.match(/\bRyzen\s+(?:AI\s+)?(?:\d\s+)?(\d{4,5})([A-Z0-9]*)\b/i);
  if (ryzenModel) {
    const num = parseInt(ryzenModel[1], 10);
    // 7000 and 9000 desktop series
    if ((num >= 7000 && num < 8000) || (num >= 9000 && num < 10000)) {
      return yes(IGPU_CANONICAL.RADEON_GRAPHICS);
    }
    // 8000 non-G are mostly mobile/APU-adjacent; without G treat as unknown/no for desktop-only catalog
    // AM4 non-G (1000–5000 except G): no iGPU
    if (num >= 1000 && num < 7000) {
      return no();
    }
  }

  // Threadripper / EPYC — no consumer iGPU
  if (/threadripper|epyc/i.test(name)) return no();

  return no();
}

/**
 * Apply structured iGPU fields to a catalog entry when missing.
 * Existing hasIgpu / igpuCanonical on the entry always win.
 */
export function enrichEntryWithIgpu(entry: HardwareCatalogEntry): HardwareCatalogEntry {
  if (entry.componentType !== 'cpu') return entry;
  if (entry.hasIgpu === true && entry.igpuCanonical) return entry;
  if (entry.hasIgpu === false) {
    // Normalize: ensure no stale igpuCanonical
    if (entry.igpuCanonical) {
      const { igpuCanonical: _drop, ...rest } = entry;
      return { ...rest, hasIgpu: false };
    }
    return entry;
  }

  const inferred = inferCpuIgpuFields(entry.canonical, entry.vendor);
  if (inferred.hasIgpu) {
    return {
      ...entry,
      hasIgpu: true,
      igpuCanonical: inferred.igpuCanonical,
    };
  }
  return {
    ...entry,
    hasIgpu: false,
  };
}

export function enrichCatalogWithIgpu(entries: HardwareCatalogEntry[]): HardwareCatalogEntry[] {
  return entries.map(enrichEntryWithIgpu);
}

/**
 * Resolve the suggested iGPU for a user-selected CPU string against a catalog list.
 * Returns null if the CPU is not in the catalog (unknown → no nudge).
 */
export function resolveIgpuForCpu(
  cpuCanonicalOrRaw: string,
  entries: HardwareCatalogEntry[]
): (CpuIgpuResolution & { cpuCanonical?: string; igpuEntry?: HardwareCatalogEntry }) | null {
  const raw = (cpuCanonicalOrRaw || '').trim();
  if (!raw) return null;

  const cpus = entries.filter((e) => e.componentType === 'cpu');
  const upper = raw.toUpperCase();

  let cpu =
    cpus.find((e) => e.canonical === raw) ||
    cpus.find((e) => e.canonical.toUpperCase() === upper);

  // Soft includes match for near-canonical paste (prefer shortest equal-ish)
  if (!cpu) {
    const hits = cpus.filter(
      (e) =>
        e.canonical.toUpperCase().includes(upper) ||
        upper.includes(e.canonical.toUpperCase())
    );
    if (hits.length === 1) cpu = hits[0];
    else if (hits.length > 1) {
      hits.sort((a, b) => a.canonical.length - b.canonical.length);
      cpu = hits[0];
    }
  }

  if (!cpu) {
    // Not in catalog: try inference alone only if name looks like a known vendor model
    if (!/ryzen|core\s|intel|amd/i.test(raw)) return null;
    const inferred = inferCpuIgpuFields(raw);
    if (!inferred.hasIgpu) return { hasIgpu: false, cpuCanonical: raw };
    const igpuEntry = entries.find(
      (e) => e.componentType === 'gpu' && e.canonical === inferred.igpuCanonical
    );
    return { ...inferred, cpuCanonical: raw, igpuEntry };
  }

  const enriched = enrichEntryWithIgpu(cpu);
  if (enriched.hasIgpu === true && enriched.igpuCanonical) {
    const igpuEntry = entries.find(
      (e) => e.componentType === 'gpu' && e.canonical === enriched.igpuCanonical
    );
    return {
      hasIgpu: true,
      igpuCanonical: enriched.igpuCanonical,
      cpuCanonical: enriched.canonical,
      igpuEntry,
    };
  }
  return { hasIgpu: false, cpuCanonical: enriched.canonical };
}

/** True when save/submit should offer the iGPU one-click fill (GPU empty + CPU has iGPU). */
export function shouldOfferIgpuOnEmptyGpu(
  cpu: string,
  gpu: string,
  entries: HardwareCatalogEntry[]
): { offer: true; igpuCanonical: string; cpuCanonical?: string } | { offer: false } {
  const gpuTrim = (gpu || '').trim();
  if (gpuTrim) return { offer: false };
  const cpuTrim = (cpu || '').trim();
  if (!cpuTrim) return { offer: false };

  const resolved = resolveIgpuForCpu(cpuTrim, entries);
  if (resolved?.hasIgpu && resolved.igpuCanonical) {
    return {
      offer: true,
      igpuCanonical: resolved.igpuCanonical,
      cpuCanonical: resolved.cpuCanonical,
    };
  }
  return { offer: false };
}
