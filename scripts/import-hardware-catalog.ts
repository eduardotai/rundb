/**
 * Hardware Catalog Importer (build-time codegen)
 *
 * Reads the compact, human-maintained dataset at
 *   seeds/hardware-catalog-dataset.json
 * validates it, and generates the typed, committed catalog file
 *   lib/hardware-catalog-generated.ts
 *
 * Run:  npm run import:hardware   (or: npx tsx scripts/import-hardware-catalog.ts)
 *
 * Design / rationale: docs/superpowers/specs/2026-06-04-hardware-catalog-importer-design.md
 *
 * Why this exists: the curated lib/hardware-catalog.ts is verbose (one ~12-line TS
 * object per SKU), so the long tail (i5-9400/9400F and many others) never got entered.
 * Maintaining hundreds of SKUs as compact JSON + generating the TS keeps coverage
 * scalable while staying fully offline/deterministic at runtime.
 *
 * Precedence: curated static (blessed) > generated. The importer therefore HARD-ERRORS
 * if a dataset canonical collides with a curated one (the dataset entry is redundant).
 *
 * perfIndex is authored per-entry in the dataset (gaming-weighted, anchored to existing
 * neighbours) — NOT synthesised from a formula — because the curated scale is hand-tuned
 * (e.g. an 8-core X3D outranks a 16-core non-X for gaming). The importer only validates it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GPU_CATALOG,
  CPU_CATALOG,
  resolveAbbreviation,
} from '../lib/hardware-catalog';
import type { HardwareCatalogEntry } from '../lib/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATASET_PATH = join(ROOT, 'seeds', 'hardware-catalog-dataset.json');
const OUT_PATH = join(ROOT, 'lib', 'hardware-catalog-generated.ts');

const GENERATED_AT = new Date().toISOString().slice(0, 10);

const ALLOWED_VENDORS = ['NVIDIA', 'AMD', 'Intel', 'Other'];

interface DatasetRecord {
  canonical: string;
  type: 'cpu' | 'gpu';
  vendor: string;
  series: string;
  perfIndex: number;
  source: string;
  year?: number;
  // CPU
  cores?: number;
  threads?: number;
  has3DVCache?: boolean;
  tdpW?: number;
  // GPU
  vramGB?: number;
  architecture?: string;
  // shared
  notes?: string;
  aliases?: string[];
}

function fail(messages: string[]): never {
  console.error('\n❌ Hardware catalog import FAILED:\n');
  for (const m of messages) console.error('  - ' + m);
  console.error(`\n${messages.length} error(s). No file written.\n`);
  process.exit(1);
}

function main() {
  const raw = readFileSync(DATASET_PATH, 'utf8');
  let dataset: DatasetRecord[];
  try {
    dataset = JSON.parse(raw);
  } catch (err) {
    fail([`Could not parse ${DATASET_PATH}: ${(err as Error).message}`]);
  }
  if (!Array.isArray(dataset!)) {
    fail(['Dataset root must be a JSON array.']);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Curated canonicals (blessed) — dataset must not collide with these.
  const curatedCanonicals = new Set<string>([
    ...Object.values(GPU_CATALOG).map((e) => e.canonical),
    ...Object.values(CPU_CATALOG).map((e) => e.canonical),
  ]);

  const seenCanonical = new Set<string>();
  const aliasMap: Record<string, string> = {};
  const entries: HardwareCatalogEntry[] = [];

  dataset!.forEach((rec, i) => {
    const where = `entry #${i}${rec?.canonical ? ` (${rec.canonical})` : ''}`;

    // Required fields
    if (!rec || typeof rec.canonical !== 'string' || !rec.canonical.trim()) {
      errors.push(`${where}: missing/empty 'canonical'`);
      return;
    }
    const canon = rec.canonical.trim();
    if (rec.type !== 'cpu' && rec.type !== 'gpu') {
      errors.push(`${where}: 'type' must be "cpu" or "gpu" (got ${JSON.stringify(rec.type)})`);
    }
    if (!ALLOWED_VENDORS.includes(rec.vendor)) {
      errors.push(`${where}: 'vendor' must be one of ${ALLOWED_VENDORS.join('/')} (got ${JSON.stringify(rec.vendor)})`);
    }
    if (typeof rec.series !== 'string' || !rec.series.trim()) {
      errors.push(`${where}: missing 'series'`);
    }
    if (typeof rec.source !== 'string' || !rec.source.trim()) {
      errors.push(`${where}: missing 'source' attribution`);
    }
    if (typeof rec.perfIndex !== 'number' || Number.isNaN(rec.perfIndex)) {
      errors.push(`${where}: 'perfIndex' must be a number`);
    } else if (rec.perfIndex < 0 || rec.perfIndex > 115) {
      errors.push(`${where}: 'perfIndex' ${rec.perfIndex} out of range 0-115`);
    }

    // Uniqueness
    if (seenCanonical.has(canon)) {
      errors.push(`${where}: duplicate canonical within dataset`);
    }
    seenCanonical.add(canon);
    if (curatedCanonicals.has(canon)) {
      errors.push(`${where}: collides with a curated catalog entry — remove it from the dataset (curated wins)`);
    }

    // Spec sanity
    if (rec.type === 'cpu') {
      if (rec.cores != null && rec.cores <= 0) errors.push(`${where}: cores must be > 0`);
      if (rec.threads != null && rec.threads <= 0) errors.push(`${where}: threads must be > 0`);
      if (rec.cores != null && rec.threads != null && rec.threads < rec.cores) {
        errors.push(`${where}: threads (${rec.threads}) < cores (${rec.cores})`);
      }
    } else if (rec.type === 'gpu') {
      if (rec.vramGB != null && rec.vramGB <= 0) errors.push(`${where}: vramGB must be > 0`);
    }

    // Aliases: warn + skip on collision with a curated shorthand or an already-claimed alias.
    if (rec.aliases) {
      for (const a of rec.aliases) {
        const key = String(a).toLowerCase().trim();
        if (!key) continue;
        const curatedHit = resolveAbbreviation(key);
        if (curatedHit && curatedHit !== canon) {
          warnings.push(`${where}: alias "${key}" already resolves to "${curatedHit}" — skipping`);
          continue;
        }
        if (aliasMap[key] && aliasMap[key] !== canon) {
          warnings.push(`${where}: alias "${key}" already claimed by "${aliasMap[key]}" — skipping`);
          continue;
        }
        aliasMap[key] = canon;
      }
    }

    // Build the typed entry (only the validatable-so-far shape; errors above still abort).
    const entry: HardwareCatalogEntry = {
      canonical: canon,
      componentType: rec.type,
      vendor: rec.vendor as HardwareCatalogEntry['vendor'],
      series: rec.series,
      perfIndex: rec.perfIndex,
      source: rec.source,
      lastUpdated: GENERATED_AT,
    };
    if (rec.year != null) entry.releaseYear = rec.year;
    if (rec.notes) entry.notes = rec.notes;
    if (rec.type === 'cpu') {
      if (rec.cores != null) entry.cores = rec.cores;
      if (rec.threads != null) entry.threads = rec.threads;
      if (rec.has3DVCache != null) entry.has3DVCache = rec.has3DVCache;
      if (rec.tdpW != null) entry.tdpW = rec.tdpW;
    } else {
      if (rec.vramGB != null) entry.vramGB = rec.vramGB;
      if (rec.architecture) entry.architecture = rec.architecture;
    }
    entries.push(entry);
  });

  if (errors.length) fail(errors);

  // Stable ordering → minimal diffs across re-runs.
  entries.sort((a, b) => a.canonical.localeCompare(b.canonical));
  const sortedAliases = Object.keys(aliasMap)
    .sort()
    .reduce<Record<string, string>>((acc, k) => ((acc[k] = aliasMap[k]), acc), {});

  const out = renderFile(entries, sortedAliases);
  writeFileSync(OUT_PATH, out, 'utf8');

  for (const w of warnings) console.warn('⚠️  ' + w);
  const gpu = entries.filter((e) => e.componentType === 'gpu').length;
  const cpu = entries.filter((e) => e.componentType === 'cpu').length;
  console.log(
    `\n✅ Generated ${OUT_PATH}\n   ${entries.length} entries (${gpu} GPU, ${cpu} CPU), ` +
      `${Object.keys(sortedAliases).length} aliases${warnings.length ? `, ${warnings.length} alias warning(s)` : ''}.\n`
  );
}

function renderEntry(e: HardwareCatalogEntry): string {
  // Render only defined fields, in a stable order, as a TS object literal.
  const lines: string[] = [];
  const push = (k: string, v: unknown) => lines.push(`    ${k}: ${JSON.stringify(v)},`);
  push('canonical', e.canonical);
  push('componentType', e.componentType);
  push('vendor', e.vendor);
  push('series', e.series);
  if (e.perfIndex != null) push('perfIndex', e.perfIndex);
  if (e.releaseYear != null) push('releaseYear', e.releaseYear);
  if (e.vramGB != null) push('vramGB', e.vramGB);
  if (e.architecture) push('architecture', e.architecture);
  if (e.cores != null) push('cores', e.cores);
  if (e.threads != null) push('threads', e.threads);
  if (e.has3DVCache != null) push('has3DVCache', e.has3DVCache);
  if (e.tdpW != null) push('tdpW', e.tdpW);
  if (e.notes) push('notes', e.notes);
  push('source', e.source);
  push('lastUpdated', e.lastUpdated);
  return `  ${JSON.stringify(e.canonical)}: {\n${lines.join('\n')}\n  },`;
}

function renderFile(entries: HardwareCatalogEntry[], aliases: Record<string, string>): string {
  const entryBlock = entries.map(renderEntry).join('\n');
  const aliasBlock = Object.entries(aliases)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');

  return `// AUTO-GENERATED by scripts/import-hardware-catalog.ts — DO NOT EDIT.
// Edit seeds/hardware-catalog-dataset.json and re-run: npm run import:hardware
//
// Source of truth: seeds/hardware-catalog-dataset.json
// Design: docs/superpowers/specs/2026-06-04-hardware-catalog-importer-design.md

import type { HardwareCatalogEntry } from './types';

export const GENERATED_CATALOG_VERSION = ${JSON.stringify('2026.06.v4')};
export const GENERATED_CATALOG_GENERATED_AT = ${JSON.stringify(GENERATED_AT)};

/** Long-tail hardware entries. Curated static entries win on canonical collision. */
export const GENERATED_CATALOG: Record<string, HardwareCatalogEntry> = {
${entryBlock}
};

/** Generated shorthand → canonical. Curated BUILTIN_ABBREVIATIONS win on collision. */
export const GENERATED_ABBREVIATIONS: Record<string, string> = {
${aliasBlock}
};
`;
}

main();
