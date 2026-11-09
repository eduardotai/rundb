'use server'

/**
 * Admin moderation Server Actions (real Supabase mode).
 *
 * Authorisation: every action resolves the session with getStaffAccess() first
 * (profiles.role or the server-only ADMIN_EMAILS allowlist). Moderator-level
 * actions accept moderators + admins; destructive actions are admin only. Only
 * after that check do we touch the service-role client, and the moderation RPCs
 * receive the verified user id as the audited actor.
 *
 * Every action returns ActionResult<T> (lib/action-result.ts) instead of throwing:
 * production Next.js hides thrown messages. lib/admin.ts unwraps on the client.
 */

import { getStaffAccess } from '@/lib/admin-access'
import { createServiceClient } from '@/lib/supabase/service'
import type { BulkImportResult, HardwareAlias, ReportImage, ReportStatus } from '@/lib/types'
import type { AdminOverviewStats, HardwareAliasInput, ImageStatus } from '@/lib/admin-logic'
import * as mod from '@/lib/server/admin-moderation'
import { UserFacingError, runAction, type ActionResult } from '@/lib/action-result'

async function requireModerator(): Promise<string> {
  const access = await getStaffAccess()
  if (!access.user || !access.canModerate) {
    throw new UserFacingError('Access denied. Moderator or admin role required.')
  }
  return access.user.id
}

async function requireAdmin(): Promise<string> {
  const access = await getStaffAccess()
  if (!access.user || !access.isAdmin) {
    throw new UserFacingError('Access denied. Admin role required.')
  }
  return access.user.id
}

// ---- Overview ---------------------------------------------------------------

export async function getAdminOverviewStatsAction(): Promise<ActionResult<AdminOverviewStats>> {
  return runAction('Failed to load admin stats.', async () => {
    await requireModerator()
    return await mod.getAdminOverviewStats(createServiceClient())
  }, '[admin:getAdminOverviewStatsAction]')
}

// ---- Reports ----------------------------------------------------------------

export async function bulkModerateReportsAction(
  reportIds: string[],
  status: ReportStatus,
  notes?: string
): Promise<ActionResult<{ updated: number }>> {
  return runAction('Failed to update report status.', async () => {
    const actor = await requireModerator()
    const updated = await mod.moderateReports(createServiceClient(), actor, reportIds, status, notes)
    return { updated }
  }, '[admin:bulkModerateReportsAction]')
}

export async function bulkDeleteReportsAction(reportIds: string[]): Promise<ActionResult<{ deleted: number }>> {
  return runAction('Failed to delete reports.', async () => {
    const actor = await requireAdmin()
    const deleted = await mod.deleteReports(createServiceClient(), actor, reportIds)
    return { deleted }
  }, '[admin:bulkDeleteReportsAction]')
}

// ---- Report images ----------------------------------------------------------

export async function getReportImagesAction(filter?: ImageStatus | 'all'): Promise<ActionResult<ReportImage[]>> {
  return runAction('Failed to load report images.', async () => {
    await requireModerator()
    return await mod.listReportImages(createServiceClient(), filter)
  }, '[admin:getReportImagesAction]')
}

export async function bulkModerateReportImagesAction(
  imageIds: string[],
  status: ImageStatus
): Promise<ActionResult<{ updated: number }>> {
  return runAction('Failed to update image status.', async () => {
    const actor = await requireModerator()
    const updated = await mod.moderateReportImages(createServiceClient(), actor, imageIds, status)
    return { updated }
  }, '[admin:bulkModerateReportImagesAction]')
}

export async function bulkDeleteReportImagesAction(imageIds: string[]): Promise<ActionResult<{ deleted: number }>> {
  return runAction('Failed to delete images.', async () => {
    const actor = await requireAdmin()
    const deleted = await mod.deleteReportImages(createServiceClient(), actor, imageIds)
    return { deleted }
  }, '[admin:bulkDeleteReportImagesAction]')
}

// ---- Hardware aliases -------------------------------------------------------

export async function getHardwareAliasesAction(search?: string): Promise<ActionResult<HardwareAlias[]>> {
  return runAction('Failed to load hardware aliases.', async () => {
    await requireModerator()
    return await mod.listHardwareAliases(createServiceClient(), search)
  }, '[admin:getHardwareAliasesAction]')
}

export async function createHardwareAliasAction(input: HardwareAliasInput): Promise<ActionResult<HardwareAlias>> {
  return runAction('Failed to add alias.', async () => {
    const actor = await requireModerator()
    return await mod.createHardwareAlias(createServiceClient(), actor, input)
  }, '[admin:createHardwareAliasAction]')
}

export async function updateHardwareAliasAction(
  id: string,
  input: HardwareAliasInput
): Promise<ActionResult<HardwareAlias>> {
  return runAction('Failed to update alias.', async () => {
    const actor = await requireModerator()
    return await mod.updateHardwareAlias(createServiceClient(), actor, id, input)
  }, '[admin:updateHardwareAliasAction]')
}

export async function deleteHardwareAliasAction(id: string): Promise<ActionResult<{ deleted: boolean }>> {
  return runAction('Failed to delete alias.', async () => {
    const actor = await requireAdmin()
    const deleted = await mod.deleteHardwareAlias(createServiceClient(), actor, id)
    return { deleted }
  }, '[admin:deleteHardwareAliasAction]')
}

// ---- Bulk game import -------------------------------------------------------

export async function bulkImportGamesAction(rows: unknown[]): Promise<ActionResult<BulkImportResult>> {
  return runAction('Bulk import failed.', async () => {
    const actor = await requireAdmin()
    return await mod.bulkImportGames(createServiceClient(), actor, rows)
  }, '[admin:bulkImportGamesAction]')
}
