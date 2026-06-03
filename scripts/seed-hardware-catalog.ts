/**
 * Seed the (large) static hardware catalog into Supabase.
 * Usage:
 *   npm run seed:hardware
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (the service_role key from Supabase Dashboard).
 * This script now properly loads .env.local like all other scripts in the project.
 *
 * Prerequisites: hardware_catalog (and hardware_aliases) table must exist.
 *   - Use supabase/incremental-hardware-catalog.sql for existing projects, or full schema.sql for fresh.
 *   - Or: npm run setup:supabase (auto-applies when ACCESS_TOKEN/DATABASE_URL present).
 */

import { loadEnvLocal } from './load-env-local'

loadEnvLocal()

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  console.log('Seeding large hardware catalog (2015-16+ v3-expanded with RX 9000 / many more) into Supabase...')
  console.log(`  Supabase URL detected: ${url ? url.replace(/https?:\/\/([^.]+).*/, 'https://$1...') : 'MISSING'}`)
  console.log(`  Service role key: ${hasServiceKey ? 'present (length ' + process.env.SUPABASE_SERVICE_ROLE_KEY!.length + ')' : 'MISSING'}`)

  if (!hasServiceKey) {
    console.error('\nERROR: SUPABASE_SERVICE_ROLE_KEY is missing after loading .env.local')
    console.log('Make sure .env.local has the service_role key (from Supabase Dashboard → Project Settings → API).')
    process.exit(1)
  }
  try {
    // Prefer the Server Action path if available in a node context (or direct via tsx of action not ideal).
    // For simplicity in scripts we call a small direct upsert using service client.
    const { createServiceClient } = await import('../lib/supabase/service');
    const supabase = createServiceClient();

    const { getAllHardwareCatalog, HARDWARE_CATALOG_VERSION } = await import('../lib/hardware-catalog');
    const entries = getAllHardwareCatalog();

    console.log(`Seeding ${entries.length} entries (v${HARDWARE_CATALOG_VERSION})...`);

    const rows = entries.map((e) => ({
      canonical: e.canonical,
      component_type: e.componentType,
      vendor: e.vendor,
      series: e.series,
      perf_index: e.perfIndex,
      vram_gb: e.vramGB,
      cores: e.cores,
      has_3d_vcache: !!e.has3DVCache,
      architecture: e.architecture,
      threads: e.threads,
      tdp_w: e.tdpW,
      memory_type: e.memoryType,
      speed_mts: e.speedMTs,
      release_year: e.releaseYear,
      notes: e.notes,
      source: `${e.source} (seeded from static v${HARDWARE_CATALOG_VERSION})`,
      last_updated: new Date().toISOString(),
    }));

    const BATCH = 40;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase.from('hardware_catalog').upsert(batch, { onConflict: 'canonical' });
      if (error) throw error;
      done += batch.length;
      console.log(`  ... ${done}/${rows.length}`);
    }

    console.log(`Done. Seeded ${done} hardware catalog entries.`);
  } catch (e: any) {
    console.error('Hardware seed failed:', e?.message || e);
    console.log('\nTip: Make sure .env.local contains YOUR Supabase project (create one at https://supabase.com if needed):');
    console.log('  NEXT_PUBLIC_SUPABASE_URL=https://YOUR-REF.supabase.co');
    console.log('  SUPABASE_SERVICE_ROLE_KEY=...  (go to your project Settings > API and copy the service_role key, NOT anon)');
    console.log('\nAlso ensure the hardware_catalog table exists in YOUR project:');
    console.log(`  - Open your project's SQL Editor: https://supabase.com/dashboard/project/YOUR-REF/sql/new`);
    console.log('  - Fresh DB: paste & run the full supabase/schema.sql');
    console.log('  - Existing DB: paste supabase/incremental-hardware-catalog.sql (or run `npm run setup:supabase` if you have access token for *your* project)');
    console.log('');
    console.log('  On Windows/PowerShell, get CLEAN SQL (no > prompts):');
    console.log('    npm run copy:sql:hardware     # easiest - copies directly to clipboard');
    console.log(`  Then paste into YOUR project's SQL Editor. First line must be a -- comment.`);
    console.log('  If it starts with ">" you accidentally included terminal output.');
    console.log('');
    console.log('Then try again: npm run seed:hardware');
    // Rethrow so the top-level handler can exit after promise settles (avoids libuv/Windows UV_HANDLE_CLOSING assertion on process.exit from inside async)
    throw e;
  }
}

main().catch(() => {
  // Perform exit only after the promise has settled. This prevents the
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" crash on Windows
  // that occurs when forcing exit while async handles (http sockets etc.) are still open.
  process.exit(1);
});
