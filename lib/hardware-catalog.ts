/**
 * RunDB Hardware Catalog (Static Curated Source of Truth)
 *
 * Phase 6+ **large** hardware database (2015-16 launches onward).
 *
 * Expanded per approved implementation plan:
 * - Full market coverage since Pascal (GTX 10) / Polaris (RX 400/500) ~2016 through newest (RTX 50 Blackwell, Zen 5, Arc Battlemage).
 * - Dense mid-range + value cards (not just flagships) so real users see their hardware.
 * - ~150+ GPUs and ~80+ CPUs target (current run: substantial increase from the original ~33).
 * - perfIndex relative (RTX 4090 = 100.0 for GPUs; gaming-weighted for CPUs).
 *
 * Design:
 * - Static + versioned (no runtime external calls).
 * - Pure, client+server safe.
 * - Live DB (hardware_catalog) acts as overrides/additions when USE_REAL=true (merged via mapper).
 * - findHardwareByQuery now supports live lists + simple relevance scoring.
 *
 * Curation (see plan §6 for full process):
 * - PassMark G3D / CPU Mark public mega pages + relative %.
 * - TechPowerUp review tables + real-game aggregates (1440p).
 * - Every entry has source + lastUpdated attribution.
 * - No scraping at runtime; updates via admin bulk or PR to this file + reseed.
 *
 * Maintenance: Admin bulk import for quick adds; curator promotes popular/obscure to static periodically.
 */

import type { HardwareCatalogEntry, HardwareComponentType } from './types';

// ============================================
// CATALOG VERSIONING
// ============================================
export const HARDWARE_CATALOG_VERSION = '2026.06.v2-large';
export const HARDWARE_CATALOG_LAST_UPDATED = '2026-06-12';

// ============================================
// GPU CATALOG — Comprehensive desktop gaming GPUs since ~2016 (Pascal/Polaris era)
// perfIndex: RTX 4090 baseline = 100.0 . Derived primarily from PassMark G3D ratios + TPU cross-checks.
// Grouped by architecture/generation for readability and maintenance.
// ============================================

export const GPU_CATALOG: Record<string, HardwareCatalogEntry> = {
  // =====================================================================
  // NVIDIA RTX 50-series (Blackwell) — newest 2025+
  // =====================================================================
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

  // =====================================================================
  // NVIDIA RTX 40-series (Ada) — dominant 2023-2025
  // =====================================================================
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

  // =====================================================================
  // NVIDIA RTX 30-series (Ampere) — still extremely common in 2026 reports
  // =====================================================================
  'NVIDIA GeForce RTX 3090 Ti': {
    canonical: 'NVIDIA GeForce RTX 3090 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 30',
    perfIndex: 62.0,
    releaseYear: 2022,
    vramGB: 24,
    architecture: 'Ampere',
    notes: 'Enthusiast 30-series. Strong 4K raster/RT for its time.',
    source: 'PassMark G3D + TPU 2022-23 reviews',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 3090': {
    canonical: 'NVIDIA GeForce RTX 3090',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 30',
    perfIndex: 58.0,
    releaseYear: 2020,
    vramGB: 24,
    architecture: 'Ampere',
    source: 'PassMark G3D (2026 historical snapshot)',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 3080 Ti': {
    canonical: 'NVIDIA GeForce RTX 3080 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 30',
    perfIndex: 55.0,
    releaseYear: 2021,
    vramGB: 12,
    architecture: 'Ampere',
    source: 'PassMark G3D + TechPowerUp',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 3080': {
    canonical: 'NVIDIA GeForce RTX 3080',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 30',
    perfIndex: 52.0,
    releaseYear: 2020,
    vramGB: 10,
    architecture: 'Ampere',
    notes: 'The 1440p/4K workhorse of the early 2020s.',
    source: 'PassMark G3D + widespread real reports',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 3070 Ti': {
    canonical: 'NVIDIA GeForce RTX 3070 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 30',
    perfIndex: 46.0,
    releaseYear: 2021,
    vramGB: 8,
    architecture: 'Ampere',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 3070': {
    canonical: 'NVIDIA GeForce RTX 3070',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 30',
    perfIndex: 44.0,
    releaseYear: 2020,
    vramGB: 8,
    architecture: 'Ampere',
    source: 'PassMark G3D + TPU',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 3060 Ti': {
    canonical: 'NVIDIA GeForce RTX 3060 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 30',
    perfIndex: 38.0,
    releaseYear: 2020,
    vramGB: 8,
    architecture: 'Ampere',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 3060': {
    canonical: 'NVIDIA GeForce RTX 3060',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 30',
    perfIndex: 33.0,
    releaseYear: 2021,
    vramGB: 12,
    architecture: 'Ampere',
    source: 'PassMark G3D + very common in user reports',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 3050': {
    canonical: 'NVIDIA GeForce RTX 3050',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 30',
    perfIndex: 24.0,
    releaseYear: 2022,
    vramGB: 8,
    architecture: 'Ampere',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },

  // =====================================================================
  // NVIDIA RTX 20 / GTX 16 (Turing) + Pascal (2016-2019) — 2015-16 launch era
  // =====================================================================
  'NVIDIA GeForce RTX 2080 Ti': {
    canonical: 'NVIDIA GeForce RTX 2080 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 20',
    perfIndex: 39.0,
    releaseYear: 2018,
    vramGB: 11,
    architecture: 'Turing',
    notes: 'First RT-capable flagship. Still capable at 1080p/1440p in 2026.',
    source: 'PassMark G3D historical + TPU',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 2080 Super': {
    canonical: 'NVIDIA GeForce RTX 2080 Super',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 20',
    perfIndex: 34.0,
    releaseYear: 2019,
    vramGB: 8,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 2080': {
    canonical: 'NVIDIA GeForce RTX 2080',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 20',
    perfIndex: 32.0,
    releaseYear: 2018,
    vramGB: 8,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 2070 Super': {
    canonical: 'NVIDIA GeForce RTX 2070 Super',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 20',
    perfIndex: 30.0,
    releaseYear: 2019,
    vramGB: 8,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 2070': {
    canonical: 'NVIDIA GeForce RTX 2070',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 20',
    perfIndex: 27.0,
    releaseYear: 2018,
    vramGB: 8,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 2060 Super': {
    canonical: 'NVIDIA GeForce RTX 2060 Super',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 20',
    perfIndex: 25.0,
    releaseYear: 2019,
    vramGB: 8,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce RTX 2060': {
    canonical: 'NVIDIA GeForce RTX 2060',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'RTX 20',
    perfIndex: 22.0,
    releaseYear: 2019,
    vramGB: 6,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1660 Ti': {
    canonical: 'NVIDIA GeForce GTX 1660 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'GTX 16',
    perfIndex: 20.0,
    releaseYear: 2019,
    vramGB: 6,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1660 Super': {
    canonical: 'NVIDIA GeForce GTX 1660 Super',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'GTX 16',
    perfIndex: 19.0,
    releaseYear: 2019,
    vramGB: 6,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1660': {
    canonical: 'NVIDIA GeForce GTX 1660',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'GTX 16',
    perfIndex: 17.5,
    releaseYear: 2019,
    vramGB: 6,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1650 Super': {
    canonical: 'NVIDIA GeForce GTX 1650 Super',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'GTX 16',
    perfIndex: 15.0,
    releaseYear: 2019,
    vramGB: 4,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1650': {
    canonical: 'NVIDIA GeForce GTX 1650',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'GTX 16',
    perfIndex: 13.0,
    releaseYear: 2019,
    vramGB: 4,
    architecture: 'Turing',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },

  // Pascal 2016 — the "since 2015-16" era
  'NVIDIA GeForce GTX 1080 Ti': {
    canonical: 'NVIDIA GeForce GTX 1080 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'Pascal',
    perfIndex: 38.0,
    releaseYear: 2017,
    vramGB: 11,
    architecture: 'Pascal',
    notes: 'Legendary 1080p/1440p card of its era. Still playable in many titles 2026 with lowered settings.',
    source: 'PassMark G3D 2026 historical snapshot + TPU',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1080': {
    canonical: 'NVIDIA GeForce GTX 1080',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'Pascal',
    perfIndex: 28.0,
    releaseYear: 2016,
    vramGB: 8,
    architecture: 'Pascal',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1070 Ti': {
    canonical: 'NVIDIA GeForce GTX 1070 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'Pascal',
    perfIndex: 25.0,
    releaseYear: 2017,
    vramGB: 8,
    architecture: 'Pascal',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1070': {
    canonical: 'NVIDIA GeForce GTX 1070',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'Pascal',
    perfIndex: 22.0,
    releaseYear: 2016,
    vramGB: 8,
    architecture: 'Pascal',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1060 6GB': {
    canonical: 'NVIDIA GeForce GTX 1060 6GB',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'Pascal',
    perfIndex: 17.0,
    releaseYear: 2016,
    vramGB: 6,
    architecture: 'Pascal',
    source: 'PassMark G3D + enormous report volume historically',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1060': {
    canonical: 'NVIDIA GeForce GTX 1060',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'Pascal',
    perfIndex: 15.0,
    releaseYear: 2016,
    vramGB: 3,
    architecture: 'Pascal',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'NVIDIA GeForce GTX 1050 Ti': {
    canonical: 'NVIDIA GeForce GTX 1050 Ti',
    componentType: 'gpu',
    vendor: 'NVIDIA',
    series: 'Pascal',
    perfIndex: 10.0,
    releaseYear: 2016,
    vramGB: 4,
    architecture: 'Pascal',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },

  // =====================================================================
  // AMD RDNA 3 (7000 series)
  // =====================================================================
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

  // =====================================================================
  // AMD RDNA 2 (6000 series) — very popular value 1440p cards
  // =====================================================================
  'AMD Radeon RX 6950 XT': {
    canonical: 'AMD Radeon RX 6950 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 2',
    perfIndex: 68.0,
    releaseYear: 2022,
    vramGB: 16,
    architecture: 'RDNA 2',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 6900 XT': {
    canonical: 'AMD Radeon RX 6900 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 2',
    perfIndex: 64.0,
    releaseYear: 2020,
    vramGB: 16,
    architecture: 'RDNA 2',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 6800 XT': {
    canonical: 'AMD Radeon RX 6800 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 2',
    perfIndex: 58.0,
    releaseYear: 2020,
    vramGB: 16,
    architecture: 'RDNA 2',
    source: 'PassMark G3D + TPU',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 6800': {
    canonical: 'AMD Radeon RX 6800',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 2',
    perfIndex: 52.0,
    releaseYear: 2020,
    vramGB: 16,
    architecture: 'RDNA 2',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 6700 XT': {
    canonical: 'AMD Radeon RX 6700 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 2',
    perfIndex: 45.0,
    releaseYear: 2021,
    vramGB: 12,
    architecture: 'RDNA 2',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 6600 XT': {
    canonical: 'AMD Radeon RX 6600 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 2',
    perfIndex: 39.0,
    releaseYear: 2021,
    vramGB: 8,
    architecture: 'RDNA 2',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 6600': {
    canonical: 'AMD Radeon RX 6600',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA 2',
    perfIndex: 35.0,
    releaseYear: 2021,
    vramGB: 8,
    architecture: 'RDNA 2',
    source: 'PassMark G3D + excellent 1080p/1440p value',
    lastUpdated: '2026-06-12',
  },

  // =====================================================================
  // AMD RDNA / Vega (5000 / Vega) 2017-2019
  // =====================================================================
  'AMD Radeon RX 5700 XT': {
    canonical: 'AMD Radeon RX 5700 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA',
    perfIndex: 32.0,
    releaseYear: 2019,
    vramGB: 8,
    architecture: 'RDNA',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 5700': {
    canonical: 'AMD Radeon RX 5700',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA',
    perfIndex: 28.0,
    releaseYear: 2019,
    vramGB: 8,
    architecture: 'RDNA',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 5600 XT': {
    canonical: 'AMD Radeon RX 5600 XT',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'RDNA',
    perfIndex: 25.0,
    releaseYear: 2020,
    vramGB: 6,
    architecture: 'RDNA',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon Vega 64': {
    canonical: 'AMD Radeon Vega 64',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'Vega',
    perfIndex: 21.0,
    releaseYear: 2017,
    vramGB: 8,
    architecture: 'Vega',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 590': {
    canonical: 'AMD Radeon RX 590',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'Polaris',
    perfIndex: 16.0,
    releaseYear: 2018,
    vramGB: 8,
    architecture: 'Polaris',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 580': {
    canonical: 'AMD Radeon RX 580',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'Polaris',
    perfIndex: 15.0,
    releaseYear: 2017,
    vramGB: 8,
    architecture: 'Polaris',
    notes: 'The 1080p king of 2017-2019. Huge installed base.',
    source: 'PassMark G3D + Steam Survey historical',
    lastUpdated: '2026-06-12',
  },
  'AMD Radeon RX 570': {
    canonical: 'AMD Radeon RX 570',
    componentType: 'gpu',
    vendor: 'AMD',
    series: 'Polaris',
    perfIndex: 12.5,
    releaseYear: 2017,
    vramGB: 4,
    architecture: 'Polaris',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },

  // =====================================================================
  // Intel Arc (Battlemage / Alchemist)
  // =====================================================================
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
  'Intel Arc A750': {
    canonical: 'Intel Arc A750',
    componentType: 'gpu',
    vendor: 'Intel',
    series: 'Arc Alchemist',
    perfIndex: 32.0,
    releaseYear: 2022,
    vramGB: 8,
    architecture: 'Alchemist',
    source: 'PassMark G3D',
    lastUpdated: '2026-06-12',
  },
  'Intel Arc A580': {
    canonical: 'Intel Arc A580',
    componentType: 'gpu',
    vendor: 'Intel',
    series: 'Arc Alchemist',
    perfIndex: 22.0,
    releaseYear: 2022,
    vramGB: 8,
    architecture: 'Alchemist',
    source: 'PassMark G3D + reviews',
    lastUpdated: '2026-06-12',
  },
};

// ============================================
// CPU CATALOG (Gaming-relevant 2020–2026, heavy emphasis on X3D)
// perfIndex here is gaming-adjusted (single-thread + cache heavy)
// ============================================

export const CPU_CATALOG: Record<string, HardwareCatalogEntry> = {
  // =====================================================================
  // AMD Zen 5 (2024-2025)
  // =====================================================================
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

  // =====================================================================
  // AMD Zen 4 (2022-2024) — still extremely relevant
  // =====================================================================
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
  'AMD Ryzen 9 7900X': {
    canonical: 'AMD Ryzen 9 7900X',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 4',
    perfIndex: 78.0,
    releaseYear: 2022,
    cores: 12,
    threads: 24,
    has3DVCache: false,
    tdpW: 170,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },

  // =====================================================================
  // AMD Zen 3 (still very common in budget/used market, legendary X3D)
  // =====================================================================
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
  'AMD Ryzen 7 5800X': {
    canonical: 'AMD Ryzen 7 5800X',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 3',
    perfIndex: 65.0,
    releaseYear: 2020,
    cores: 8,
    threads: 16,
    has3DVCache: false,
    tdpW: 105,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 5 5600X': {
    canonical: 'AMD Ryzen 5 5600X',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 3',
    perfIndex: 58.0,
    releaseYear: 2020,
    cores: 6,
    threads: 12,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark + very common',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 5 5600': {
    canonical: 'AMD Ryzen 5 5600',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 3',
    perfIndex: 55.0,
    releaseYear: 2022,
    cores: 6,
    threads: 12,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 7 5700G': {
    canonical: 'AMD Ryzen 7 5700G',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 3',
    perfIndex: 48.0,
    releaseYear: 2021,
    cores: 8,
    threads: 16,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },

  // =====================================================================
  // AMD Zen 2 / Zen+ / Zen 1 (2017-2020) — 2015-16 launch era coverage
  // =====================================================================
  'AMD Ryzen 9 3900X': {
    canonical: 'AMD Ryzen 9 3900X',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 2',
    perfIndex: 52.0,
    releaseYear: 2019,
    cores: 12,
    threads: 24,
    has3DVCache: false,
    tdpW: 105,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 7 3700X': {
    canonical: 'AMD Ryzen 7 3700X',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 2',
    perfIndex: 48.0,
    releaseYear: 2019,
    cores: 8,
    threads: 16,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 5 3600': {
    canonical: 'AMD Ryzen 5 3600',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 2',
    perfIndex: 42.0,
    releaseYear: 2019,
    cores: 6,
    threads: 12,
    has3DVCache: false,
    tdpW: 65,
    notes: 'Excellent value 1080p/1440p CPU for years.',
    source: 'PassMark + massive adoption',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 7 2700X': {
    canonical: 'AMD Ryzen 7 2700X',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen+',
    perfIndex: 35.0,
    releaseYear: 2018,
    cores: 8,
    threads: 16,
    has3DVCache: false,
    tdpW: 105,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 5 2600': {
    canonical: 'AMD Ryzen 5 2600',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen+',
    perfIndex: 30.0,
    releaseYear: 2018,
    cores: 6,
    threads: 12,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'AMD Ryzen 7 1700': {
    canonical: 'AMD Ryzen 7 1700',
    componentType: 'cpu',
    vendor: 'AMD',
    series: 'Zen 1',
    perfIndex: 26.0,
    releaseYear: 2017,
    cores: 8,
    threads: 16,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },

  // =====================================================================
  // Intel 14th/13th gen (Raptor Lake Refresh)
  // =====================================================================
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

  // =====================================================================
  // Intel 12th gen (Alder Lake) — still seen in many reports
  // =====================================================================
  'Intel Core i9-12900K': {
    canonical: 'Intel Core i9-12900K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Alder Lake',
    perfIndex: 64.0,
    releaseYear: 2021,
    cores: 16,
    threads: 24,
    has3DVCache: false,
    tdpW: 241,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
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
  'Intel Core i5-12600K': {
    canonical: 'Intel Core i5-12600K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Alder Lake',
    perfIndex: 55.0,
    releaseYear: 2021,
    cores: 10,
    threads: 16,
    has3DVCache: false,
    tdpW: 150,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i5-12400': {
    canonical: 'Intel Core i5-12400',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Alder Lake',
    perfIndex: 48.0,
    releaseYear: 2022,
    cores: 6,
    threads: 12,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark + very common budget',
    lastUpdated: '2026-06-12',
  },

  // =====================================================================
  // Intel 10th/11th gen (Comet Lake / Rocket Lake) + 8th/9th — 2015-16+ era
  // =====================================================================
  'Intel Core i9-10900K': {
    canonical: 'Intel Core i9-10900K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Comet Lake',
    perfIndex: 52.0,
    releaseYear: 2020,
    cores: 10,
    threads: 20,
    has3DVCache: false,
    tdpW: 125,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i7-10700K': {
    canonical: 'Intel Core i7-10700K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Comet Lake',
    perfIndex: 46.0,
    releaseYear: 2020,
    cores: 8,
    threads: 16,
    has3DVCache: false,
    tdpW: 125,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i5-10400': {
    canonical: 'Intel Core i5-10400',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Comet Lake',
    perfIndex: 38.0,
    releaseYear: 2020,
    cores: 6,
    threads: 12,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark + widespread',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i7-9700K': {
    canonical: 'Intel Core i7-9700K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Coffee Lake Refresh',
    perfIndex: 40.0,
    releaseYear: 2018,
    cores: 8,
    threads: 8,
    has3DVCache: false,
    tdpW: 95,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i7-8700K': {
    canonical: 'Intel Core i7-8700K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Coffee Lake',
    perfIndex: 35.0,
    releaseYear: 2017,
    cores: 6,
    threads: 12,
    has3DVCache: false,
    tdpW: 95,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i5-8400': {
    canonical: 'Intel Core i5-8400',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Coffee Lake',
    perfIndex: 30.0,
    releaseYear: 2017,
    cores: 6,
    threads: 6,
    has3DVCache: false,
    tdpW: 65,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },

  // 6th/7th gen (Skylake / Kaby Lake) — core of the 2015-16 launch period
  'Intel Core i7-7700K': {
    canonical: 'Intel Core i7-7700K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Kaby Lake',
    perfIndex: 28.0,
    releaseYear: 2017,
    cores: 4,
    threads: 8,
    has3DVCache: false,
    tdpW: 91,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i5-7600K': {
    canonical: 'Intel Core i5-7600K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Kaby Lake',
    perfIndex: 24.0,
    releaseYear: 2017,
    cores: 4,
    threads: 4,
    has3DVCache: false,
    tdpW: 91,
    source: 'PassMark',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i7-6700K': {
    canonical: 'Intel Core i7-6700K',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Skylake',
    perfIndex: 25.0,
    releaseYear: 2015,
    cores: 4,
    threads: 8,
    has3DVCache: false,
    tdpW: 91,
    notes: 'Iconic 2015-2016 high-end. Still appears in older rigs.',
    source: 'PassMark historical',
    lastUpdated: '2026-06-12',
  },
  'Intel Core i5-6500': {
    canonical: 'Intel Core i5-6500',
    componentType: 'cpu',
    vendor: 'Intel',
    series: 'Skylake',
    perfIndex: 20.0,
    releaseYear: 2015,
    cores: 4,
    threads: 4,
    has3DVCache: false,
    tdpW: 65,
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

export function findHardwareByQuery(
  query: string,
  limit = 12,
  entries?: HardwareCatalogEntry[]
): HardwareCatalogEntry[] {
  if (!query || query.trim().length < 1) return [];

  const q = query.toLowerCase().trim();
  const list = entries && entries.length > 0 ? entries : ALL_ENTRIES;

  // Direct abbrev resolve first (e.g. "i7 6700k")
  const abbr = resolveAbbreviation(query);
  if (abbr) {
    const direct = getHardwareEntry(abbr);
    if (direct) return [direct];
  }

  // Score-based ranking for better UX with large catalog (old simple includes was first-N only)
  type Scored = { entry: HardwareCatalogEntry; score: number };
  const scored: Scored[] = [];

  for (const entry of list) {
    const canon = entry.canonical.toLowerCase();
    const haystack = `${canon} ${entry.vendor.toLowerCase()} ${entry.series.toLowerCase()} ${entry.architecture || ''}`.toLowerCase();

    let score = 0;
    if (canon === q) score = 100;
    else if (canon.startsWith(q)) score = 85;
    else if (haystack.includes(q)) {
      // Word-ish bonus
      if (haystack.split(/\s+/).some((w) => w.startsWith(q))) score = 70;
      else score = 40;
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.entry.canonical.localeCompare(b.entry.canonical));

  // Dedup by canonical just in case
  const seen = new Set<string>();
  const results: HardwareCatalogEntry[] = [];
  for (const s of scored) {
    if (!seen.has(s.entry.canonical)) {
      seen.add(s.entry.canonical);
      results.push(s.entry);
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
// Expanded for large 2015+ catalog — covers shorthands, older gens, common typos/variants.
const BUILTIN_ABBREVIATIONS: Record<string, string> = {
  // High-end recent (keep + extend)
  '4090': 'NVIDIA GeForce RTX 4090',
  '4080 super': 'NVIDIA GeForce RTX 4080 Super',
  '4080s': 'NVIDIA GeForce RTX 4080 Super',
  '4070 ti super': 'NVIDIA GeForce RTX 4070 Ti Super',
  '4070 ti': 'NVIDIA GeForce RTX 4070 Ti',
  '4070 super': 'NVIDIA GeForce RTX 4070 Super',
  '4070': 'NVIDIA GeForce RTX 4070',
  '4060 ti': 'NVIDIA GeForce RTX 4060 Ti',
  '4060': 'NVIDIA GeForce RTX 4060',
  '5090': 'NVIDIA GeForce RTX 5090',
  '5080': 'NVIDIA GeForce RTX 5080',
  '5070 ti': 'NVIDIA GeForce RTX 5070 Ti',
  '5070': 'NVIDIA GeForce RTX 5070',
  '7900 xtx': 'AMD Radeon RX 7900 XTX',
  '7900 xt': 'AMD Radeon RX 7900 XT',
  '7800 xt': 'AMD Radeon RX 7800 XT',
  '7800x3d': 'AMD Ryzen 7 7800X3D',
  '9800x3d': 'AMD Ryzen 7 9800X3D',
  '5800x3d': 'AMD Ryzen 7 5800X3D',

  // Older NVIDIA (Pascal / Turing / Ampere common)
  '1080 ti': 'NVIDIA GeForce GTX 1080 Ti',
  '1080ti': 'NVIDIA GeForce GTX 1080 Ti',
  '1080': 'NVIDIA GeForce GTX 1080',
  '1070': 'NVIDIA GeForce GTX 1070',
  '1060': 'NVIDIA GeForce GTX 1060',
  '1050 ti': 'NVIDIA GeForce GTX 1050 Ti',
  '1660': 'NVIDIA GeForce GTX 1660',
  '1660 super': 'NVIDIA GeForce GTX 1660 Super',
  '1650': 'NVIDIA GeForce GTX 1650',
  '2060': 'NVIDIA GeForce RTX 2060',
  '2070': 'NVIDIA GeForce RTX 2070',
  '2080': 'NVIDIA GeForce RTX 2080',
  '3060': 'NVIDIA GeForce RTX 3060',
  '3060 ti': 'NVIDIA GeForce RTX 3060 Ti',
  '3070': 'NVIDIA GeForce RTX 3070',
  '3080': 'NVIDIA GeForce RTX 3080',
  '3090': 'NVIDIA GeForce RTX 3090',

  // Older AMD
  '580': 'AMD Radeon RX 580',
  '570': 'AMD Radeon RX 570',
  '480': 'AMD Radeon RX 480',
  'vega 64': 'AMD Radeon Vega 64',
  '5700 xt': 'AMD Radeon RX 5700 XT',
  '5600 xt': 'AMD Radeon RX 5600 XT',
  '6700 xt': 'AMD Radeon RX 6700 XT',
  '6800 xt': 'AMD Radeon RX 6800 XT',
  '6900 xt': 'AMD Radeon RX 6900 XT',

  // Intel CPUs common shorthands
  '14900k': 'Intel Core i9-14900K',
  '14700k': 'Intel Core i7-14700K',
  '14600k': 'Intel Core i5-14600K',
  '13600k': 'Intel Core i5-13600K',
  '12700k': 'Intel Core i7-12700K',
  '6700k': 'Intel Core i7-6700K',
  'i7 6700k': 'Intel Core i7-6700K',
  'i7-6700k': 'Intel Core i7-6700K',
  '7700k': 'Intel Core i7-7700K',
  '8700k': 'Intel Core i7-8700K',
  '9700k': 'Intel Core i7-9700K',
  '10700k': 'Intel Core i7-10700K',
  '11700k': 'Intel Core i7-11700K',
  '10400': 'Intel Core i5-10400',
  '11400': 'Intel Core i5-11400',
  '12400': 'Intel Core i5-12400',
  '13400': 'Intel Core i5-13400',

  // AMD Ryzen older + value
  '3600': 'AMD Ryzen 5 3600',
  '5600': 'AMD Ryzen 5 5600',
  '5600x': 'AMD Ryzen 5 5600X',
  '5700g': 'AMD Ryzen 7 5700G',
  '5800x': 'AMD Ryzen 7 5800X',
  '3700x': 'AMD Ryzen 7 3700X',
  '2700x': 'AMD Ryzen 7 2700X',
  '1700': 'AMD Ryzen 7 1700',
  '7600': 'AMD Ryzen 5 7600',
  '7700x': 'AMD Ryzen 7 7700X',
  '7900x': 'AMD Ryzen 9 7900X',
  '9950x': 'AMD Ryzen 9 9950X',
};

export function resolveAbbreviation(raw: string): string | undefined {
  const cleaned = raw.toLowerCase().trim();
  return BUILTIN_ABBREVIATIONS[cleaned];
}

/**
 * Quick stats helper (used by admin + verify scripts).
 */
export function getHardwareCatalogStats() {
  const gpus = Object.values(GPU_CATALOG);
  const cpus = Object.values(CPU_CATALOG);
  const years = [...gpus, ...cpus].map((e) => e.releaseYear).filter((y): y is number => !!y);
  return {
    gpuCount: gpus.length,
    cpuCount: cpus.length,
    total: gpus.length + cpus.length,
    minReleaseYear: years.length ? Math.min(...years) : null,
    maxReleaseYear: years.length ? Math.max(...years) : null,
    vendors: Array.from(new Set([...gpus, ...cpus].map((e) => e.vendor))),
  };
}

export function isCatalogInitialized(): boolean {
  return ALL_ENTRIES.length > 0;
}