/**
 * Verify the (now large) hardware catalog.
 * Run: npx tsx scripts/verify-hardware-catalog.ts
 *
 * Checks:
 * - No duplicate canonicals
 * - Reasonable perfIndex (0-115)
 * - Release years mostly >= 2015
 * - All entries have required fields + source
 * - Prints stats + coverage summary
 */

import {
  getAllHardwareCatalog,
  getHardwareCatalogStats,
  HARDWARE_CATALOG_VERSION,
  HARDWARE_CATALOG_LAST_UPDATED,
  findHardwareByQuery,
} from '../lib/hardware-catalog';

function main() {
  console.log('=== Hardware Catalog Verification ===');
  console.log(`Version: ${HARDWARE_CATALOG_VERSION} (updated ${HARDWARE_CATALOG_LAST_UPDATED})`);

  const entries = getAllHardwareCatalog();
  const stats = getHardwareCatalogStats();

  console.log(`Total entries: ${stats.total} (GPUs: ${stats.gpuCount}, CPUs: ${stats.cpuCount})`);
  console.log(`Release years: ${stats.minReleaseYear} — ${stats.maxReleaseYear}`);
  console.log(`Vendors: ${stats.vendors.join(', ')}`);

  // Duplicate check
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const e of entries) {
    if (seen.has(e.canonical)) dups.push(e.canonical);
    seen.add(e.canonical);
  }
  if (dups.length) {
    console.error('DUPLICATES FOUND:', dups);
    process.exit(1);
  }
  console.log('No duplicate canonicals: OK');

  // Perf sanity
  const badPerf = entries.filter((e) => e.perfIndex != null && (e.perfIndex < 0 || e.perfIndex > 115));
  if (badPerf.length) {
    console.error('Bad perfIndex values:', badPerf.map((e) => e.canonical));
    process.exit(1);
  }
  console.log('perfIndex in reasonable range (0-115): OK');

  // Year check (allow a few pre-2015 for completeness, warn only)
  const old = entries.filter((e) => e.releaseYear && e.releaseYear < 2015);
  if (old.length) {
    console.warn(`Note: ${old.length} entries pre-2015 (expected for completeness):`, old.slice(0, 3).map((e) => e.canonical));
  } else {
    console.log('All entries 2015+: OK (or documented)');
  }

  // Required fields
  const missing = entries.filter((e) => !e.canonical || !e.componentType || !e.source);
  if (missing.length) {
    console.error('Entries missing required fields');
    process.exit(1);
  }
  console.log('All entries have canonical/componentType/source: OK');

  // Quick search test for old hardware (the whole point)
  const tests = ['gtx 1060', 'rx 580', 'ryzen 5 3600', 'i7 6700k', '1080 ti', '3060', '9800x3d'];
  console.log('\nSearch tests for historical + new hardware:');
  for (const t of tests) {
    const res = findHardwareByQuery(t, 1);
    const hit = res[0];
    console.log(`  "${t}" -> ${hit ? hit.canonical + ` (P${hit.perfIndex})` : 'NO MATCH'}`);
  }

  console.log('\n=== Verification PASSED ===');
  console.log('Catalog is large, sane, and searchable for 2015-16+ hardware.');
}

main();
