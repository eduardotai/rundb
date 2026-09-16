'use server'

/**
 * Admin moderation Server Actions (real Supabase mode).
 *
 * Authorisation: every action resolves the session with getStaffAccess() first
 * (profiles.role or the server-only ADMIN_EMAILS allowlist). Moderator-level
 * actions accept moderators + admins; destructive actions are admin only. Only
 * after that check do we touch the service-role client, and the moderation RPCs
 * receive the verified user id as the audited actor.
 */

import { getStaffAccess } from '@/lib/admin-access'
import { createServiceClient } from '@/lib/supabase/service'
import type { BulkImportResult, HardwareAlias, ReportImage, ReportStatus } from '@/lib/types'
import type { AdminOverviewStats, HardwareAliasInput, ImageStatus } from '@/lib/admin-logic'
import * as mod from '@/lib/server/admin-moderation'

async function requireModerator(): Promise<string> {
  const access = await getStaffAccess()
  if (!access.user || !access.canModerate) {
    throw new Error('Access denied. Moderator or admin role required.')
  }
  return access.user.id
}

async function requireAdmin(): Promise<string> {
  const access = await getStaffAccess()
  if (!access.user || !access.isAdmin) {
    throw new Error('Access denied. Admin role required.')
  }
  return access.user.id
}

/** Re-throw with a stable, user-safe message (server actions must never leak raw 500s). */
function friendly(err: unknown, fallback: string): never {
  const message = err instanceof Error && err.message ? err.message : fallback
  throw new Error(message)
}

// ---- Overview ---------------------------------------------------------------

export async function getAdminOverviewStatsAction(): Promise<AdminOverviewStats> {
  await requireModerator()
  try {
    return await mod.getAdminOverviewStats(createServiceClient())
  } catch (err) {
    friendly(err, 'Failed to load admin stats.')
  }
}

// ---- Reports ----------------------------------------------------------------

export async function bulkModerateReportsAction(
  reportIds: string[],
  status: ReportStatus,
  notes?: string
): Promise<{ updated: number }> {
  const actor = await requireModerator()
  try {
    const updated = await mod.moderateReports(createServiceClient(), actor, reportIds, status, notes)
    return { updated }
  } catch (err) {
    friendly(err, 'Failed to update report status.')
  }
}

export async function bulkDeleteReportsAction(reportIds: string[]): Promise<{ deleted: number }> {
  const actor = await requireAdmin()
  try {
    const deleted = await mod.deleteReports(createServiceClient(), actor, reportIds)
    return { deleted }
  } catch (err) {
    friendly(err, 'Failed to delete reports.')
  }
}

// ---- Report images ----------------------------------------------------------

export async function getReportImagesAction(filter?: ImageStatus | 'all'): Promise<ReportImage[]> {
  await requireModerator()
  try {
    return await mod.listReportImages(createServiceClient(), filter)
  } catch (err) {
    friendly(err, 'Failed to load report images.')
  }
}

export async function bulkModerateReportImagesAction(
  imageIds: string[],
  status: ImageStatus
): Promise<{ updated: number }> {
  const actor = await requireModerator()
  try {
    const updated = await mod.moderateReportImages(createServiceClient(), actor, imageIds, status)
    return { updated }
  } catch (err) {
    friendly(err, 'Failed to update image status.')
  }
}

export async function bulkDeleteReportImagesAction(imageIds: string[]): Promise<{ deleted: number }> {
  const actor = await requireAdmin()
  try {
    const deleted = await mod.deleteReportImages(createServiceClient(), actor, imageIds)
    return { deleted }
  } catch (err) {
    friendly(err, 'Failed to delete images.')
  }
}

// ---- Hardware aliases -------------------------------------------------------

export async function getHardwareAliasesAction(search?: string): Promise<HardwareAlias[]> {
  await requireModerator()
  try {
    return await mod.listHardwareAliases(createServiceClient(), search)
  } catch (err) {
    friendly(err, 'Failed to load hardware aliases.')
  }
}

export async function createHardwareAliasAction(input: HardwareAliasInput): Promise<HardwareAlias> {
  const actor = await requireModerator()
  try {
    return await mod.createHardwareAlias(createServiceClient(), actor, input)
  } catch (err) {
    friendly(err, 'Failed to add alias.')
  }
}

export async function updateHardwareAliasAction(
  id: string,
  input: HardwareAliasInput
): Promise<HardwareAlias> {
  const actor = await requireModerator()
  try {
    return await mod.updateHardwareAlias(createServiceClient(), actor, id, input)
  } catch (err) {
    friendly(err, 'Failed to update alias.')
  }
}

export async function deleteHardwareAliasAction(id: string): Promise<{ deleted: boolean }> {
  const actor = await requireAdmin()
  try {
    const deleted = await mod.deleteHardwareAlias(createServiceClient(), actor, id)
    return { deleted }
  } catch (err) {
    friendly(err, 'Failed to delete alias.')
  }
}

// ---- Bulk game import -------------------------------------------------------

export async function bulkImportGamesAction(rows: unknown[]): Promise<BulkImportResult> {
  const actor = await requireAdmin()
  try {
    return await mod.bulkImportGames(createServiceClient(), actor, rows)
  } catch (err) {
    friendly(err, 'Bulk import failed.')
  }
}
