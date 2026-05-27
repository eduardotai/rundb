'use server'

/**
 * Hardware Catalog Server Actions (Production Live)
 * 
 * Only moderators and admins can modify the live catalog.
 * These actions are the bridge that makes the hardware database "live in production".
 */

import { createClient } from '@/lib/supabase/server'
import type { HardwareCatalogEntry } from '@/lib/types'

export async function upsertHardwareCatalogEntry(entry: Partial<HardwareCatalogEntry> & { canonical: string }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Authentication required')

  // Verify role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['moderator', 'admin'].includes(profile.role)) {
    throw new Error('Only moderators and admins can manage the hardware catalog')
  }

  const payload = {
    ...entry,
    last_updated: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('hardware_catalog')
    .upsert(payload, { onConflict: 'canonical' })

  if (error) {
    console.error('[hardware-catalog] upsert error', error)
    throw new Error(error.message)
  }

  return { success: true }
}

export async function deleteHardwareCatalogEntry(canonical: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Authentication required')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['moderator', 'admin'].includes(profile.role)) {
    throw new Error('Only moderators and admins can manage the hardware catalog')
  }

  const { error } = await supabase
    .from('hardware_catalog')
    .delete()
    .eq('canonical', canonical)

  if (error) throw new Error(error.message)

  return { success: true }
}

/**
 * Seed the entire static catalog into the live DB (idempotent).
 * Very useful for going live the first time.
 */
export async function seedStaticCatalogIntoDatabase() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Authentication required')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    throw new Error('Only admins can perform full catalog seeding')
  }

  // Import the rich static catalog
  const { getAllHardwareCatalog, HARDWARE_CATALOG_VERSION } = await import('@/lib/hardware-catalog')
  const staticEntries = getAllHardwareCatalog()

  const rows = staticEntries.map((e: any) => ({
    canonical: e.canonical,
    component_type: e.componentType,
    vendor: e.vendor,
    series: e.series,
    perf_index: e.perfIndex,
    vram_gb: e.vramGB,
    cores: e.cores,
    has_3d_vcache: e.has3DVCache || false,
    memory_type: e.memoryType,
    speed_mts: e.speedMTs,
    release_year: e.releaseYear,
    notes: e.notes,
    source: `${e.source} (seeded from static v${HARDWARE_CATALOG_VERSION})`,
  }))

  // Upsert in batches
  const BATCH_SIZE = 50
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('hardware_catalog')
      .upsert(batch, { onConflict: 'canonical' })

    if (error) {
      console.error('Seeding batch failed', error)
      throw new Error(`Seeding failed at batch ${i / BATCH_SIZE}: ${error.message}`)
    }
  }

  return { 
    success: true, 
    seeded: rows.length,
    message: `Successfully seeded ${rows.length} entries into live hardware_catalog table`
  }
}