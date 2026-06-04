const CATALOG_UNKNOWN_PREFIX = '[Catalog: unknown hardware]'

export function cleanPublicReportNotes(notes?: string | null): string | undefined {
  if (!notes) return undefined
  const cleaned = notes.replace(CATALOG_UNKNOWN_PREFIX, '').trim()
  return cleaned || undefined
}
