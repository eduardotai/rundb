/**
 * Seed the (large) static hardware catalog into Supabase.
 * Usage:
 *   npm run seed:hardware
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (the service_role key from Supabase Dashboard).
 * This script now properly loads .env.local like all other scripts in the project.
 */

import { loadEnvLocal } from './load-env-local'

loadEnvLocal()

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  console.log('Seeding large hardware catalog (2015-16+ expanded) into Supabase...')
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
    console.log('\nTip: Make sure .env.local contains:');
    console.log('  NEXT_PUBLIC_SUPABASE_URL=...');
    console.log('  SUPABASE_SERVICE_ROLE_KEY=...  (the service_role key, NOT the anon key)');
    console.log('\nAlso ensure you have run the updated supabase/schema.sql (with hardware_catalog columns + aliases RLS) in your Supabase SQL editor.');
    console.log('Then try again: npm run seed:hardware');
    process.exit(1);
  }
}

main();
