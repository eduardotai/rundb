/**
 * RunDB Hardware Catalog (Static Curated Source of Truth)
 *
 * Phase 6+ full hardware database implementation.
 *
 * Design decisions (per approved plan):
 * - Static + versioned (no runtime external API calls in user paths).
 * - Client + server safe (pure functions only).
 * - GPUs + CPUs only for MVP (highest impact on predictions + similarity).
 * - perfIndex is relative gaming performance (flagship GPU ≈ 100).
 * - Works identically in mock and real (NEXT_PUBLIC_USE_REAL_DATA) modes.
 * - Unknown hardware always falls back gracefully.
 *
 * Data sources for curation (attributed per entry):
 * - PassMark videocardbenchmark.net / cpubenchmark.net public mega pages (G3D / CPU Mark averages)
 * - TechPowerUp public review tables + relative performance charts
 * - Community mirrors (dbgpu, RightNow-GPU-Database) for architecture/VRAM details
 * - Real-world game benchmark aggregates (Cyberpunk, Alan Wake 2, Black Myth, etc. at 1440p)
 *
 * Maintenance: Quarterly + major launch (RTX 50 / Ryzen 9000 / Intel Ultra 3) updates via PR or admin import.
 * Never scrape at runtime.
 */

import type { HardwareCatalogEntry, HardwareComponentType } from './types';

// ============================================
// CATALOG VERSIONING
// ============================================
export const HARDWARE_CATALOG_VERSION = '2026.06.v1';
export const HARDWARE_CATALOG_LAST_UPDATED = '2026-06-12';

// ============================================
// GPU CATALOG (Desktop gaming cards 2020–2026, focus on current market)
// perfIndex normalized so RTX 4090 = 100.0 (strong raster + RT proxy)
// ============================================

export const GPU_CATALOG: Record<string, HardwareCatalogEntry> = {
  // NVIDIA RTX 50-series (Blackwell) — 2025+
  'NVIDIA GeForce RTX 5090': {
    canonical: 'NVIDIA GeForce RTX 5090',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 50',
    perfIndex: 108.0,
    releaseYear: 2025,
    vramGB: 32,
    architecture: 'Blackwell',
    notes: 'Flagship 2025. Massive 4K/8K + full RT + MFG leader.',
    source: 'PassMark G3D + TechPowerUp relative charts (2025-2026 reviews)',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 5080': {
    canonical: 'NVIDIA GeForce RTX 5080',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 50',
    perfIndex: 94.0,
    releaseYear: 2025,
    vramGB: 16,
    architecture: 'Blackwell',
    notes: 'High-end 1440p/4K sweet spot.',
    source: 'PassMark G3D + TechPowerUp relative charts (2025-2026 reviews)',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 5070 Ti': {
    canonical: 'NVIDIA GeForce RTX 5070 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 50',
    perfIndex: 78.0,
    releaseYear: 2025,
    vramGB: 16,
    architecture: 'Blackwell',
    source: 'PassMark G3D + real-game 1440p aggregates',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 5070': {
    canonical: 'NVIDIA GeForce RTX 5070',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 50',
    perfIndex: 68.0,
    releaseYear: 2025,
    vramGB: 12,
    architecture: 'Blackwell',
    source: 'PassMark G3D + real-game 1440p aggregates',
    lastUpdated: '2026-06-12',
  },

  // NVIDIA RTX 40-series (Ada) — dominant 2023-2025
  'NVIDIA GeForce RTX 4090': {
    canonical: 'NVIDIA GeForce RTX 4090',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 100.0,
    releaseYear: 2022,
    vramGB: 24,
    architecture: 'Ada',
    notes: 'Previous gen flagship. Still excellent 4K/RT king in 2026.',
    source: 'PassMark videocardbenchmark.net G3D Mark (2026 snapshot) + TPU',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 4080 Super': {
    canonical: 'NVIDIA GeForce RTX 4080 Super',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 87.0,
    releaseYear: 2024,
    vramGB: 16,
    architecture: 'Ada',
    source: 'PassMark G3D + TechPowerUp relative performance',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 4080': {
    canonical: 'NVIDIA GeForce RTX 4080',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 84.0,
    releaseYear: 2022,
    vramGB: 16,
    architecture: 'Ada',
    source: 'PassMark G3D + TechPowerUp',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 4070 Ti Super': {
    canonical: 'NVIDIA GeForce RTX 4070 Ti Super',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 75.0,
    releaseYear: 2024,
    vramGB: 16,
    architecture: 'Ada',
    notes: 'Outstanding 1440p + strong 4K with DLSS.',
    source: 'PassMark G3D + multiple 1440p/4K game reviews',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 4070 Ti': {
    canonical: 'NVIDIA GeForce RTX 4070 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 71.0,
    releaseYear: 2023,
    vramGB: 12,
    architecture: 'Ada',
    source: 'PassMark G3D + TechPowerUp',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 4070 Super': {
    canonical: 'NVIDIA GeForce RTX 4070 Super',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 67.0,
    releaseYear: 2024,
    vramGB: 12,
    architecture: 'Ada',
    source: 'PassMark G3D + real-world 1440p data',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 4070': {
    canonical: 'NVIDIA GeForce RTX 4070',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 62.0,
    releaseYear: 2023,
    vramGB: 12,
    architecture: 'Ada',
    source: 'PassMark G3D + TechPowerUp',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 4060 Ti 16GB': {
    canonical: 'NVIDIA GeForce RTX 4060 Ti 16GB',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 51.0,
    releaseYear: 2023,
    vramGB: 16,
    architecture: 'Ada',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 4060 Ti': {
    canonical: 'NVIDIA GeForce RTX 4060 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 48.0,
    releaseYear: 2023,
    vramGB: 8,
    architecture: 'Ada',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 4060': {
    canonical: 'NVIDIA GeForce RTX 4060',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 40',
    perfIndex: 43.0,
    releaseYear: 2023,
    vramGB: 8,
    architecture: 'Ada',
    source: 'PassMark G3D + widespread 1080p/1440p reports',
    lastUpdated: '2026-06-12',
  },

  // AMD RDNA 3 (7000 series)
  'AMD Radeon RX 7900 XTX': {
    canonical: 'AMD Radeon RX 7900 XTX',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 3',
    perfIndex: 82.0,
    releaseYear: 2022,
    vramGB: 24,
    architecture: 'RDNA 3',
    notes: 'Best raster value flagship of previous gen. Strong 4K.',
    source: 'PassMark G3D + TechPowerUp + game benchmarks',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 7900 XT': {
    canonical: 'AMD Radeon RX 7900 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 3',
    perfIndex: 74.0,
    releaseYear: 2022,
    vramGB: 20,
    architecture: 'RDNA 3',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 7800 XT': {
    canonical: 'AMD Radeon RX 7800 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 3',
    perfIndex: 64.0,
    releaseYear: 2023,
    vramGB: 16,
    architecture: 'RDNA 3',
    source: 'PassMark G3D + real 1440p data',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 7700 XT': {
    canonical: 'AMD Radeon RX 7700 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 3',
    perfIndex: 58.0,
    releaseYear: 2023,
    vramGB: 12,
    architecture: 'RDNA 3',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 7600': {
    canonical: 'AMD Radeon RX 7600',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 3',
    perfIndex: 47.0,
    releaseYear: 2023,
    vramGB: 8,
    architecture: 'RDNA 3',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },

  // Intel Arc (Battlemage / Alchemist) — improving but smaller mindshare
  'Intel Arc B580': {
    canonical: 'Intel Arc B580',
    componentType: 'gpu',
    vendor: 'Intel',
    series: 'Arc Battlemage',
    perfIndex: 41.0,
    releaseYear: 2024,
    vramGB: 12,
    architecture: 'Battlemage',
    source: 'PassMark G3D + 2025 reviews',
    lastUpdated: '2026-06-12',
  },
  'Intel Arc A770': {
    canonical: 'Intel Arc A770',
    componentType: 'gpu',
    vendor: 'Intel',
    series: 'Arc Alchemist',
    perfIndex: 36.0,
    releaseYear: 2022,
    vramGB: 16,
    architecture: 'Alchemist',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
};

// ============================================
// CPU CATALOG (Gaming-relevant 2020–2026, heavy emphasis on X3D)
// perfIndex here is gaming-adjusted (single-thread + cache heavy)
// ============================================

export const CPU_CATALOG: Record<string, HardwareCatalogEntry> = {
  // AMD Zen 5 (2024-2025)
  'AMD Ryzen 7 9800X3D': {
    canonical: 'AMD Ryzen 7 9800X3D',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 5',
    perfIndex: 96.0,
    releaseYear: 2024,
    cores: 8,
    threads: 16,
    has3DVCache: true,
    tdpW: 120,
    notes: 'Current gaming king. Massive L3 cache advantage.',
    source: 'PassMark CPU Mark (gaming proxies) + real 1440p/4K game data',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 9 9950X': {
    canonical: 'AMD Ryzen 9 9950X',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 5',
    perfIndex: 82.0,
    releaseYear: 2024,
    cores: 16,
    threads: 32,
    has3DVCache: false,
    tdpW: 170,
    source: 'PassMark + productivity/gaming mix',
    lastUpdated: '2026-06-12',
  },

  // AMD Zen 4 (2022-2024) — still extremely relevant
  'AMD Ryzen 7 7800X3D': {
    canonical: 'AMD Ryzen 7 7800X3D',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 4',
    perfIndex: 92.0,
    releaseYear: 2023,
    cores: 8,
    threads: 16,
    has3DVCache: true,
    tdpW: 120,
    notes: 'Previous gen gaming champion. Still top 3 in 2026.',
    source: 'PassMark + thousands of real reports across titles',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 7 7700X': {
    canonical: 'AMD Ryzen 7 7700X',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 4',
    perfIndex: 74.0,
    releaseYear: 2022,
    cores: 8,
    threads: 16,
    has3DVCache: false,
    tdpW: 105,
    source: 'PassMark CPU Mark',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 5 7600': {
    canonical: 'AMD Ryzen 5 7600',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 4',
    perfIndex: 68.0,
    releaseYear: 2023,
    cores: 6,
    threads: 12,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark + widespread adoption',
    lastUpdated: '2026-06-12',
  },

  // AMD Zen 3 (still very common in budget/used market)
  'AMD Ryzen 7 5800X3D': {
    canonical: 'AMD Ryzen 7 5800X3D',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 3',
    perfIndex: 78.0,
    releaseYear: 2022,
    cores: 8,
    threads: 16,
    has3DVCache: true,
    tdpW: 105,
    notes: 'Legendary AM4 gaming CPU. Still punches way above price.',
    source: 'PassMark + enormous historical report volume',
    lastUpdated: '2026-06-12',
  },

  // Intel 14th/13th gen (Raptor Lake Refresh)
  'Intel Core i9-14900K': {
    canonical: 'Intel Core i9-14900K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Raptor Lake',
    perfIndex: 79.0,
    releaseYear: 2023,
    cores: 24,
    threads: 32,
    has3DVCache: false,
    tdpW: 253,
    source: 'PassMark CPU Mark (gaming weighted)',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i7-14700K': {
    canonical: 'Intel Core i7-14700K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Raptor Lake',
    perfIndex: 75.0,
    releaseYear: 2024,
    cores: 20,
    threads: 28,
    has3DVCache: false,
    tdpW: 253,
    source: 'PassMark + real gaming benchmarks',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i5-14600K': {
    canonical: 'Intel Core i5-14600K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Raptor Lake',
    perfIndex: 70.0,
    releaseYear: 2024,
    cores: 14,
    threads: 20,
    has3DVCache: false,
    tdpW: 181,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i7-13700K': {
    canonical: 'Intel Core i7-13700K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Raptor Lake',
    perfIndex: 72.0,
    releaseYear: 2022,
    cores: 16,
    threads: 24,
    has3DVCache: false,
    tdpW: 253,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i5-13600K': {
    canonical: 'Intel Core i5-13600K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Raptor Lake',
    perfIndex: 66.0,
    releaseYear: 2022,
    cores: 14,
    threads: 20,
    has3DVCache: false,
    tdpW: 181,
    source: 'PassMark + very common in reports',
    lastUpdated: '2026-06-12',
  },

  // Intel 12th gen (still seen in many reports)
  'Intel Core i7-12700K': {
    canonical: 'Intel Core i7-12700K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Alder Lake',
    perfIndex: 61.0,
    releaseYear: 2021,
    cores: 12,
    threads: 20,
    has3DVCache: false,
    tdpW: 190,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
};

// ============================================
// COMBINED ACCESSORS (pure, fast)
// ============================================

const ALL_ENTRIES = [
  ...Object.values(GPU_CATALOG),
  ...Object.values(CPU_CATALOG),
];

export function getAllHardwareCatalog(): HardwareCatalogEntry[] {
  return ALL_ENTRIES;
}

export function getHardwareEntry(canonical: string): HardwareCatalogEntry | undefined {
  if (!canonical) return undefined;
  const upper = canonical.toUpperCase().trim();

  // Direct match
  if (GPU_CATALOG[canonical]) return GPU_CATALOG[canonical];
  if (CPU_CATALOG[canonical]) return CPU_CATALOG[canonical];

  // Case-insensitive fallback
  for (const entry of ALL_ENTRIES) {
    if (entry.canonical.toUpperCase() === upper) return entry;
  }
  return undefined;
}

export function getPerfIndex(canonicalOrRaw: string): number | undefined {
  const entry = getHardwareEntry(canonicalOrRaw);
  return entry?.perfIndex;
}

export function findHardwareByQuery(query: string, limit = 12): HardwareCatalogEntry[] {
  if (!query || query.trim().length < 1) return [];

  const q = query.toLowerCase().trim();
  const results: HardwareCatalogEntry[] = [];

  for (const entry of ALL_ENTRIES) {
    const haystack = `${entry.canonical} ${entry.vendor} ${entry.series} ${entry.architecture || ''}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push(entry);
      if (results.length >= limit) break;
    }
  }
  return results;
}

export function getCatalogVersionInfo() {
  return {
    version: HARDWARE_CATALOG_VERSION,
    lastUpdated: HARDWARE_CATALOG_LAST_UPDATED,
    gpuCount: Object.keys(GPU_CATALOG).length,
    cpuCount: Object.keys(CPU_CATALOG).length,
  };
}

// Small built-in common raw → canonical map (supplements HardwareAlias table)
const BUILTIN_ABBREVIATIONS: Record<string, string> = {
  '4090': 'NVIDIA GeForce RTX 4090',
  '4080 super': 'NVIDIA GeForce RTX 4080 Super',
  '4070 ti super': 'NVIDIA GeForce RTX 4070 Ti Super',
  '4070 ti': 'NVIDIA GeForce RTX 4070 Ti',
  '4070 super': 'NVIDIA GeForce RTX 4070 Super',
  '4070': 'NVIDIA GeForce RTX 4070',
  '4060 ti': 'NVIDIA GeForce RTX 4060 Ti',
  '4060': 'NVIDIA GeForce RTX 4060',
  '7900 xtx': 'AMD Radeon RX 7900 XTX',
  '7900 xt': 'AMD Radeon RX 7900 XT',
  '7800 xt': 'AMD Radeon RX 7800 XT',
  '7800x3d': 'AMD Ryzen 7 7800X3D',
  '9800x3d': 'AMD Ryzen 7 9800X3D',
  '5800x3d': 'AMD Ryzen 7 5800X3D',
  '14900k': 'Intel Core i9-14900K',
  '14700k': 'Intel Core i7-14700K',
  '14600k': 'Intel Core i5-14600K',
  '13600k': 'Intel Core i5-13600K',
};

export function resolveAbbreviation(raw: string): string | undefined {
  const cleaned = raw.toLowerCase().trim();
  return BUILTIN_ABBREVIATIONS[cleaned];
}

export function isCatalogInitialized(): boolean {
  return ALL_ENTRIES.length > 0;
}