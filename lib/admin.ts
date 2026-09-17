/**
 * RunDB Admin Adapter (client-safe).
 *
 * Single async facade for app/admin. Real mode (USE_REAL) calls the protected
 * Server Actions in app/actions/admin.ts (staff-checked, audited RPCs). Demo
 * mode lazily imports lib/admin-demo.ts (mock + localStorage) so the demo
 * fixture never ships in the real-mode /admin bundle.
 */

import { USE_REAL, getAllGames } from './data'
import type { AdminOverviewStats, HardwareAliasInput, ImageStatus } from './admin-logic'
import { EMPTY_ADMIN_STATS } from './admin-logic'
import type {
  AdminReport,
  BulkImportResult,
  Game,
  HardwareAlias,
  ReportImage,
  ReportStatus,
} from './types'

export { parseCSV } from './data-logic'
export type { AdminOverviewStats, HardwareAliasInput, ImageStatus } from './admin-logic'

type DemoModule = typeof import('./admin-demo')
let demoPromise: Promise<DemoModule> | null = null
function loadDemo(): Promise<DemoModule> {
  demoPromise ??= import('./admin-demo')
  return demoPromise
}

type ActionsModule = typeof import('@/app/actions/admin')
let actionsPromise: Promise<ActionsModule> | null = null
function loadActions(): Promise<ActionsModule> {
  actionsPromise ??= import('@/app/actions/admin')
  return actionsPromise
}

// ---- Overview ---------------------------------------------------------------

export async function getAdminOverviewStats(): Promise<AdminOverviewStats> {
  if (!USE_REAL) return (await loadDemo()).getAdminOverviewStats()
  try {
    return await (await loadActions()).getAdminOverviewStatsAction()
  } catch (err) {
    console.warn('[admin] stats unavailable:', err instanceof Error ? err.message : err)
    return EMPTY_ADMIN_STATS
  }
}

// ---- Reports ----------------------------------------------------------------

export async function getModerationQueue(filter?: ReportStatus | 'all'): Promise<AdminReport[]> {
  if (!USE_REAL) return (await loadDemo()).getModerationQueue(filter)
  const { getModerationQueueAction } = await import('@/app/actions/reports')
  return getModerationQueueAction(filter)
}

/**
 * Set the status of one or many reports. `notes` semantics: undefined keeps the
 * existing moderator notes, a string (even empty) replaces them.
 */
export async function moderateReports(
  reportIds: string[],
  status: ReportStatus,
  notes?: string
): Promise<number> {
  if (!USE_REAL) {
    const demo = await loadDemo()
    let n = 0
    for (const id of reportIds) if (demo.updateReportStatus(id, status, notes)) n++
    return n
  }
  const { updated } = await (await loadActions()).bulkModerateReportsAction(reportIds, status, notes)
  return updated
}

export async function deleteReports(reportIds: string[]): Promise<number> {
  if (!USE_REAL) return (await loadDemo()).deleteReports(reportIds)
  const { deleted } = await (await loadActions()).bulkDeleteReportsAction(reportIds)
  return deleted
}

// ---- Report images ----------------------------------------------------------

export async function getReportImages(filter?: ImageStatus | 'all'): Promise<ReportImage[]> {
  if (!USE_REAL) return (await loadDemo()).getReportImages(filter)
  return (await loadActions()).getReportImagesAction(filter)
}

export async function moderateReportImages(imageIds: string[], status: ImageStatus): Promise<number> {
  if (!USE_REAL) {
    const demo = await loadDemo()
    let n = 0
    for (const id of imageIds) if (demo.updateImageStatus(id, status)) n++
    return n
  }
  const { updated } = await (await loadActions()).bulkModerateReportImagesAction(imageIds, status)
  return updated
}

export async function deleteReportImages(imageIds: string[]): Promise<number> {
  if (!USE_REAL) {
    const demo = await loadDemo()
    let n = 0
    for (const id of imageIds) if (demo.deleteReportImage(id)) n++
    return n
  }
  const { deleted } = await (await loadActions()).bulkDeleteReportImagesAction(imageIds)
  return deleted
}

// ---- Hardware aliases -------------------------------------------------------

export async function getHardwareAliases(search?: string): Promise<HardwareAlias[]> {
  if (!USE_REAL) return (await loadDemo()).getHardwareAliases(search)
  return (await loadActions()).getHardwareAliasesAction(search)
}

export async function createHardwareAlias(input: HardwareAliasInput): Promise<HardwareAlias> {
  if (!USE_REAL) {
    const created = (await loadDemo()).addHardwareAlias(
      input.rawString,
      input.canonical,
      input.vendor ?? undefined,
      input.series ?? undefined
    )
    if (!created) throw new Error('An alias already exists for that raw string.')
    return created
  }
  return (await loadActions()).createHardwareAliasAction(input)
}

export async function updateHardwareAlias(id: string, input: HardwareAliasInput): Promise<HardwareAlias> {
  if (!USE_REAL) {
    const demo = await loadDemo()
    const ok = demo.updateHardwareAlias(id, {
      rawString: input.rawString,
      canonical: input.canonical,
      vendor: input.vendor ?? undefined,
      series: input.series ?? undefined,
    })
    if (!ok) throw new Error('Alias not found.')
    const updated = demo.getHardwareAliases().find((a) => a.id === id)
    if (!updated) throw new Error('Alias not found.')
    return updated
  }
  return (await loadActions()).updateHardwareAliasAction(id, input)
}

export async function deleteHardwareAlias(id: string): Promise<boolean> {
  if (!USE_REAL) return Boolean((await loadDemo()).deleteHardwareAlias(id))
  const { deleted } = await (await loadActions()).deleteHardwareAliasAction(id)
  return deleted
}

// ---- Games ------------------------------------------------------------------

export async function getAllGamesForAdmin(): Promise<Game[]> {
  if (!USE_REAL) return (await loadDemo()).getAllGamesForAdmin()
  return getAllGames()
}

export async function bulkImportGames(rows: unknown[]): Promise<BulkImportResult> {
  if (!USE_REAL) return (await loadDemo()).bulkImportGames(rows as Record<string, unknown>[])
  return (await loadActions()).bulkImportGamesAction(rows)
}
