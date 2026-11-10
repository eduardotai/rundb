/**
 * GPU series matching for report filters.
 *
 * Catalog series are architecture names ("RDNA 3", "Arc Battlemage") for AMD/Intel and
 * marketing names ("RTX 40", "GTX 16") for NVIDIA. A plain substring check of the series
 * label against the report's GPU string ("AMD Radeon RX 7800 XT".includes("RDNA 3")) never
 * matches for AMD/Intel, so the filter returned nothing. Instead, resolve the report GPU to
 * its catalog entry and compare the entry's series, with a model-number heuristic for
 * labels like "RTX 40" / "RX 7000" and a substring fallback for model filters ("RX 7800 XT").
 */
import { normalizeHardwareSync } from './normalize-hardware'

export interface GpuSeriesOption {
  value: string
  label: string
}

/** Desktop GPU series offered by the game-detail filter, newest first per vendor. */
export const GPU_SERIES_FILTER_OPTIONS: readonly GpuSeriesOption[] = [
  { value: 'RTX 50', label: 'RTX 50' },
  { value: 'RTX 40', label: 'RTX 40' },
  { value: 'RTX 30', label: 'RTX 30' },
  { value: 'RTX 20', label: 'RTX 20' },
  { value: 'GTX 16', label: 'GTX 16' },
  { value: 'RDNA 4', label: 'RX 9000 (RDNA 4)' },
  { value: 'RDNA 3', label: 'RX 7000 (RDNA 3)' },
  { value: 'RDNA 2', label: 'RX 6000 (RDNA 2)' },
  { value: 'RDNA', label: 'RX 5000 (RDNA)' },
  { value: 'Arc Battlemage', label: 'Arc B-series' },
  { value: 'Arc Alchemist', label: 'Arc A-series' },
]

const MIN_CONFIDENCE = 0.6
const seriesCache = new Map<string, string | null>()

/** Catalog series for a raw GPU string, or null when it can't be resolved confidently. */
export function gpuSeriesOf(gpu: string): string | null {
  const key = gpu.trim()
  if (!key) return null
  const cached = seriesCache.get(key)
  if (cached !== undefined) return cached
  const result = normalizeHardwareSync(key)
  const series =
    result.entry && result.entry.componentType === 'gpu' && result.confidence >= MIN_CONFIDENCE
      ? result.entry.series ?? null
      : null
  seriesCache.set(key, series)
  return series
}

const SERIES_LABEL = /^(RTX|GTX|RX)\s*(\d{2,4})$/i

/**
 * "RTX 40" matches RTX 40xx; "RX 7000" matches RX 7xxx; "RX 500" matches RX 5xx.
 * Two-digit labels are NVIDIA generations (first two digits of a 4-digit model).
 */
function matchesModelNumberLabel(gpu: string, label: string): boolean | null {
  const m = SERIES_LABEL.exec(label.trim())
  if (!m) return null
  const prefix = m[1].toUpperCase()
  const digits = m[2]
  const model = new RegExp(`\\b${prefix}\\s*-?(\\d{3,4})`, 'i').exec(gpu)
  if (!model) return false
  const num = model[1]
  if (digits.length === 2) return num.length === 4 && num.startsWith(digits)
  const significant = digits.replace(/0+$/, '') || digits
  return num.length === digits.length && num.startsWith(significant)
}

export function gpuMatchesSeries(gpu: string, series: string): boolean {
  const wanted = series.trim()
  if (!wanted) return true
  if (!gpu) return false
  const resolved = gpuSeriesOf(gpu)
  if (resolved && resolved.toLowerCase() === wanted.toLowerCase()) return true
  const byLabel = matchesModelNumberLabel(gpu, wanted)
  if (byLabel !== null) return byLabel
  return gpu.toUpperCase().includes(wanted.toUpperCase())
}
