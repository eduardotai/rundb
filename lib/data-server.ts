/**
 * Server-only data helpers. Keep separate from lib/data.ts so client components
 * (e.g. my-rig-indicator) never pull in next/headers via the Supabase server client.
 */

const USE_REAL = process.env.NEXT_PUBLIC_USE_REAL_DATA === 'true'

export async function getHardwareCatalogServer() {
  if (USE_REAL) {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = await createClient()

      const { data } = await supabase
        .from('hardware_catalog')
        .select('*')
        .order('perf_index', { ascending: false })

      if (data?.length) return data
    } catch {}
  }
  const { getAllHardwareCatalog } = await import('./hardware-catalog')
  return getAllHardwareCatalog()
}
