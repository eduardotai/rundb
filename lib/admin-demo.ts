/**
 * RunDB Admin Demo Adapter
 *
 * Mock/localStorage-backed admin tools (moderation queue, hardware aliases,
 * bulk import, image moderation). Only reached through lib/admin.ts when
 * USE_REAL is false; the real Supabase paths live in app/actions/admin.ts.
 *
 * This module statically imports mock-data, so lib/admin.ts loads it with a
 * dynamic import to keep the demo fixture out of real-mode bundles.
 */

import * as mock from './mock-data'
import type { HardwareAlias, ReportStatus } from './types'
import { ALLOW_MOCK_DATA, enrichGamesWithCoversSync } from './data'
import type { BulkImportResult } from './types'

export { parseCSV } from './data-logic'

export function getAdminOverviewStats() {
  return ALLOW_MOCK_DATA ? mock.getAdminOverviewStats() : {
    totalReports: 0,
    pendingReports: 0,
    totalGames: 0,
    pendingImages: 0,
    hardwareAliases: 0,
    importedGames: 0,
  }
}

export function getModerationQueue(filterStatus?: ReportStatus | 'all') {
  return ALLOW_MOCK_DATA ? mock.getModerationQueue(filterStatus) : []
}

export function updateReportStatus(
  reportId: string,
  status: ReportStatus,
  moderatorNotes?: string,
  moderatorName?: string
) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.updateReportStatus(reportId, status, moderatorNotes, moderatorName)
}

/**
 * Demo approximation of the admin-only hard delete: user-created reports are removed
 * from localStorage; immutable seed reports are marked rejected instead.
 */
export function deleteReports(reportIds: string[]): number {
  if (!ALLOW_MOCK_DATA) return 0
  const ids = new Set(reportIds)
  const userReports = mock.loadUserReports()
  const remaining = userReports.filter((r) => !ids.has(r.id))
  if (remaining.length !== userReports.length) mock.saveUserReports(remaining)
  const removedUser = new Set(userReports.filter((r) => ids.has(r.id)).map((r) => r.id))
  let count = removedUser.size
  for (const id of ids) {
    if (removedUser.has(id)) continue
    if (mock.updateReportStatus(id, 'rejected', '[deleted in demo]')) count++
  }
  return count
}

export function getHardwareAliases(search?: string) {
  return ALLOW_MOCK_DATA ? mock.getHardwareAliases(search) : []
}

export function addHardwareAlias(rawString: string, canonical: string, vendor?: string, series?: string) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.addHardwareAlias(rawString, canonical, vendor, series)
}

export function updateHardwareAlias(id: string, updates: Partial<Omit<HardwareAlias, 'id' | 'createdAt'>>) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.updateHardwareAlias(id, updates)
}

export function deleteHardwareAlias(id: string) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.deleteHardwareAlias(id)
}

export function getAllGamesForAdmin() {
  return enrichGamesWithCoversSync(mock.getAllGames())
}

export function bulkImportGames(rows: Record<string, unknown>[]): BulkImportResult {
  if (!ALLOW_MOCK_DATA) {
    return {
      success: 0,
      errors: [{ row: 0, message: 'Mock bulk import is disabled for public deploy.' }],
      imported: [],
    }
  }
  return mock.bulkImportGames(rows)
}

export function getReportImages(filterStatus?: 'pending' | 'approved' | 'rejected' | 'all') {
  return ALLOW_MOCK_DATA ? mock.getReportImages(filterStatus) : []
}

export function updateImageStatus(imageId: string, status: 'pending' | 'approved' | 'rejected') {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.updateImageStatus(imageId, status)
}

export function deleteReportImage(imageId: string) {
  if (!ALLOW_MOCK_DATA) return undefined
  return mock.deleteReportImage(imageId)
}
