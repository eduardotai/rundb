/**
 * Server-only data helpers. Keep separate from lib/data.ts so client components
 * (e.g. my-rig-indicator) never pull in next/headers via the Supabase server client.
 */

import {
  dbRowToHardwareCatalogEntry,
  mergeDbRowsIntoStatic,
} from './hardware-catalog-mapper'
import type { HardwareCatalogEntry } from './types'

const USE_REAL = process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true'

export async function getHardwareCatalogServer(): Promise<HardwareCatalogEntry[]> {
  const { getAllHardwareCatalog } = await import('./hardware-catalog')
  const staticEntries = getAllHardwareCatalog()

  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = await createClient()

      const { data } = await supabase
        .from('hardware_catalog')
        .select('*')
        .order('perf_index', { ascending: false })

      if (data?.length) {
        return mergeDbRowsIntoStatic(staticEntries, data)
      }
    } catch {}
  }
  return staticEntries
}
