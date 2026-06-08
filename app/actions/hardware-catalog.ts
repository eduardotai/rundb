'use server'

/**
 * Hardware Catalog Server Actions (Production Live)
 * 
 * Only moderators and admins can modify the live catalog.
 * These actions are the bridge that makes the hardware database "live in production".
 */

import { createClient } from '@/lib/supabase/server'
import type { HardwareCatalogEntry } from '@/lib/types'
import { hardwareCatalogEntryToDbRow } from '@/lib/hardware-catalog-mapper'

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

  // Map to DB shape (handles camel/snake + new fields like architecture/threads/tdp_w)
  const dbRow = hardwareCatalogEntryToDbRow({
    ...entry,
    // Provide sane defaults for required mapper fields if partial
    componentType: (entry as any).componentType || (entry as any).component_type || 'gpu',
    vendor: (entry as any).vendor || 'Other',
    series: (entry as any).series || 'Unknown',
    source: (entry as any).source || 'admin-upsert',
    lastUpdated: new Date().toISOString(),
  } as HardwareCatalogEntry)

  const { error } = await supabase
    .from('hardware_catalog')
    .upsert(dbRow, { onConflict: 'canonical' })

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

  // Use central mapper for full fidelity (new columns + correct snake_case)
  const rows = staticEntries.map((e) => {
    const row = hardwareCatalogEntryToDbRow(e)
    // Prefix source for audit (seed provenance)
    row.source = `${e.source} (seeded from static v${HARDWARE_CATALOG_VERSION})`
    return row
  })

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

/**
 * Bulk upsert many hardware catalog entries (for admin CSV/JSON import).
 * Allows moderators + admins (broader than full seed which is admin-only).
 * Idempotent by canonical. Returns summary (success count + any errors for partial failures).
 * Uses the central mapper so new fields (architecture, tdp_w, threads, etc.) round-trip correctly.
 */
export async function bulkUpsertHardwareCatalogEntries(
  entries: Array<Partial<HardwareCatalogEntry> & { canonical: string }>
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Authentication required')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['moderator', 'admin'].includes(profile.role)) {
    throw new Error('Only moderators and admins can bulk manage the hardware catalog')
  }

  if (!entries || entries.length === 0) {
    return { success: true, processed: 0, message: 'No entries provided' }
  }

  const now = new Date().toISOString()
  const BATCH_SIZE = 50
  let processed = 0
  const errors: Array<{ canonical: string; error: string }> = []

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batchInput = entries.slice(i, i + BATCH_SIZE)

    const batchRows = batchInput.map((raw) => {
      try {
        // Build a minimal valid entry then map (mapper requires certain fields)
        const asEntry: HardwareCatalogEntry = {
          canonical: raw.canonical,
          componentType: (raw as any).componentType || (raw as any).component_type || 'gpu',
          vendor: (raw as any).vendor || 'Other',
          series: (raw as any).series || 'Unknown',
          perfIndex: (raw as any).perfIndex ?? (raw as any).perf_index ?? undefined,
          releaseYear: (raw as any).releaseYear ?? (raw as any).release_year ?? undefined,
          vramGB: (raw as any).vramGB ?? (raw as any).vram_gb ?? undefined,
          architecture: (raw as any).architecture,
          cores: (raw as any).cores,
          threads: (raw as any).threads,
          has3DVCache: (raw as any).has3DVCache ?? (raw as any).has_3d_vcache ?? false,
          tdpW: (raw as any).tdpW ?? (raw as any).tdp_w,
          memoryType: (raw as any).memoryType ?? (raw as any).memory_type,
          speedMTs: (raw as any).speedMTs ?? (raw as any).speed_mts,
          notes: (raw as any).notes,
          source: (raw as any).source || 'admin-bulk',
          lastUpdated: now,
        }
        const row = hardwareCatalogEntryToDbRow(asEntry)
        row.last_updated = now
        return row
      } catch (e: any) {
        errors.push({ canonical: raw.canonical, error: e?.message || 'mapping failed' })
        return null
      }
    }).filter(Boolean) as any[]

    if (batchRows.length === 0) continue

    const { error } = await supabase
      .from('hardware_catalog')
      .upsert(batchRows, { onConflict: 'canonical' })

    if (error) {
      console.error('[hardware-catalog] bulk upsert batch error', error)
      // Record per-item if possible, else mark the whole batch
      batchInput.forEach((it) => {
        if (!errors.some((e) => e.canonical === it.canonical)) {
          errors.push({ canonical: it.canonical, error: error.message })
        }
      })
    } else {
      processed += batchRows.length
    }
  }

  const failed = errors.length
  return {
    success: failed === 0,
    processed,
    failed,
    errors: failed > 0 ? errors : undefined,
    message: failed === 0
      ? `Bulk upserted ${processed} hardware catalog entries`
      : `Bulk upserted ${processed} entries, ${failed} failed (see errors)`,
  }
}
