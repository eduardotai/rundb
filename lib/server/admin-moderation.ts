/**
 * Server-only admin moderation helpers.
 *
 * Every function takes an explicit Supabase client so the server actions in
 * app/actions/admin.ts can pass the service-role client (after getStaffAccess()
 * authorised the session) and unit tests can pass an in-memory stub.
 *
 * Writes that change moderation state go through the SECURITY DEFINER RPCs from
 * supabase/incremental-admin-moderation.sql so every change is audited in
 * public.moderation_log and the same authorisation rules apply if a client ever
 * calls the RPC directly with its own session.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BulkImportResult, Game, HardwareAlias, ReportImage, ReportStatus } from '@/lib/types'
import {
  type AdminOverviewStats,
  type ImageStatus,
  cleanModeratorNotes,
  isImageStatus,
  isReportStatus,
  mapDbHardwareAlias,
  mapDbReportImage,
  normalizeBulkIds,
  parseBulkGameRows,
  validateHardwareAliasInput,
  type HardwareAliasInput,
} from '@/lib/admin-logic'

const LIST_LIMIT = 200

function rpcCount(data: unknown): number {
  const n = Number(data)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function moderateReports(
  client: SupabaseClient,
  actorId: string,
  reportIds: string[],
  status: ReportStatus,
  notes?: string | null
): Promise<number> {
  if (!isReportStatus(status)) throw new Error('Invalid report status.')
  const ids = normalizeBulkIds(reportIds)
  const { data, error } = await client.rpc('moderate_reports', {
    p_report_ids: ids,
    p_status: status,
    // undefined = keep existing notes; explicit string (possibly empty) = replace.
    p_notes: notes === undefined ? null : cleanModeratorNotes(notes) ?? '',
    p_actor: actorId,
  })
  if (error) {
    console.error('[admin-moderation] moderate_reports error', error)
    throw new Error(error.message || 'Failed to update report status.')
  }
  return rpcCount(data)
}

export async function deleteReports(
  client: SupabaseClient,
  actorId: string,
  reportIds: string[]
): Promise<number> {
  const ids = normalizeBulkIds(reportIds)
  const { data, error } = await client.rpc('delete_reports', {
    p_report_ids: ids,
    p_actor: actorId,
  })
  if (error) {
    console.error('[admin-moderation] delete_reports error', error)
    throw new Error(error.message || 'Failed to delete reports.')
  }
  return rpcCount(data)
}

// ---------------------------------------------------------------------------
// Report images
// ---------------------------------------------------------------------------

export async function listReportImages(
  client: SupabaseClient,
  filterStatus?: ImageStatus | 'all'
): Promise<ReportImage[]> {
  let query = client
    .from('report_images')
    .select('id, report_id, image_url, caption, status, created_at')
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (filterStatus && filterStatus !== 'all') {
    if (!isImageStatus(filterStatus)) throw new Error('Invalid image status.')
    query = query.eq('status', filterStatus)
  }
  const { data, error } = await query
  if (error) {
    console.error('[admin-moderation] report_images select error', error)
    throw new Error(error.message || 'Failed to load report images.')
  }
  return (data ?? []).map(mapDbReportImage)
}

export async function moderateReportImages(
  client: SupabaseClient,
  actorId: string,
  imageIds: string[],
  status: ImageStatus
): Promise<number> {
  if (!isImageStatus(status)) throw new Error('Invalid image status.')
  const ids = normalizeBulkIds(imageIds)
  const { data, error } = await client.rpc('moderate_report_images', {
    p_image_ids: ids,
    p_status: status,
    p_actor: actorId,
  })
  if (error) {
    console.error('[admin-moderation] moderate_report_images error', error)
    throw new Error(error.message || 'Failed to update image status.')
  }
  return rpcCount(data)
}

export async function deleteReportImages(
  client: SupabaseClient,
  actorId: string,
  imageIds: string[]
): Promise<number> {
  const ids = normalizeBulkIds(imageIds)
  const { data, error } = await client.rpc('delete_report_images', {
    p_image_ids: ids,
    p_actor: actorId,
  })
  if (error) {
    console.error('[admin-moderation] delete_report_images error', error)
    throw new Error(error.message || 'Failed to delete images.')
  }
  return rpcCount(data)
}

// ---------------------------------------------------------------------------
// Hardware aliases
// ---------------------------------------------------------------------------

export async function listHardwareAliases(
  client: SupabaseClient,
  search?: string
): Promise<HardwareAlias[]> {
  let query = client
    .from('hardware_aliases')
    .select('id, raw_string, canonical, vendor, series, created_at')
    .order('raw_string', { ascending: true })
    .limit(LIST_LIMIT)
  const q = search?.trim()
  if (q) {
    // PostgREST or-filter; escape commas/parens that would break the filter grammar.
    const safe = q.replace(/[,()]/g, ' ').replace(/[%_]/g, '\\$&')
    query = query.or(`raw_string.ilike.%${safe}%,canonical.ilike.%${safe}%,vendor.ilike.%${safe}%`)
  }
  const { data, error } = await query
  if (error) {
    console.error('[admin-moderation] hardware_aliases select error', error)
    throw new Error(error.message || 'Failed to load hardware aliases.')
  }
  return (data ?? []).map(mapDbHardwareAlias)
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '23505' || /duplicate key|unique/i.test(error?.message ?? '')
}

export async function createHardwareAlias(
  client: SupabaseClient,
  actorId: string,
  input: HardwareAliasInput
): Promise<HardwareAlias> {
  const row = validateHardwareAliasInput(input)
  const { data, error } = await client
    .from('hardware_aliases')
    .insert(row)
    .select('id, raw_string, canonical, vendor, series, created_at')
    .single()
  if (error || !data) {
    if (isUniqueViolation(error)) throw new Error('An alias already exists for that raw string.')
    console.error('[admin-moderation] hardware_aliases insert error', error)
    throw new Error(error?.message || 'Failed to add alias.')
  }
  await logModeration(client, actorId, 'hardware_alias', data.id, 'create', null, row.canonical)
  return mapDbHardwareAlias(data)
}

export async function updateHardwareAlias(
  client: SupabaseClient,
  actorId: string,
  id: string,
  input: HardwareAliasInput
): Promise<HardwareAlias> {
  const [aliasId] = normalizeBulkIds([id])
  const row = validateHardwareAliasInput(input)
  const { data, error } = await client
    .from('hardware_aliases')
    .update(row)
    .eq('id', aliasId)
    .select('id, raw_string, canonical, vendor, series, created_at')
    .single()
  if (error || !data) {
    if (isUniqueViolation(error)) throw new Error('An alias already exists for that raw string.')
    console.error('[admin-moderation] hardware_aliases update error', error)
    throw new Error(error?.message || 'Failed to update alias.')
  }
  await logModeration(client, actorId, 'hardware_alias', aliasId, 'update', null, row.canonical)
  return mapDbHardwareAlias(data)
}

export async function deleteHardwareAlias(
  client: SupabaseClient,
  actorId: string,
  id: string
): Promise<boolean> {
  const [aliasId] = normalizeBulkIds([id])
  const { data, error } = await client
    .from('hardware_aliases')
    .delete()
    .eq('id', aliasId)
    .select('id')
  if (error) {
    console.error('[admin-moderation] hardware_aliases delete error', error)
    throw new Error(error.message || 'Failed to delete alias.')
  }
  const removed = (data ?? []).length > 0
  if (removed) await logModeration(client, actorId, 'hardware_alias', aliasId, 'delete', null, null)
  return removed
}

// ---------------------------------------------------------------------------
// Bulk game import
// ---------------------------------------------------------------------------

export async function bulkImportGames(
  client: SupabaseClient,
  actorId: string,
  rows: unknown[]
): Promise<BulkImportResult> {
  const result: BulkImportResult = { success: 0, errors: [], imported: [] }
  if (!Array.isArray(rows) || rows.length === 0) return result
  if (rows.length > 500) {
    result.errors.push({ row: 0, message: 'At most 500 rows can be imported per batch.' })
    return result
  }

  const parsed = parseBulkGameRows(rows)
  const valid = parsed.filter((p): p is Extract<typeof p, { ok: true }> => p.ok)
  for (const p of parsed) if (!p.ok) result.errors.push({ row: p.row, message: p.message })
  if (valid.length === 0) return result

  const { data: existing, error: existingErr } = await client
    .from('games')
    .select('slug')
    .in('slug', valid.map((v) => v.game.slug))
  if (existingErr) {
    console.error('[admin-moderation] bulk import dedup error', existingErr)
    throw new Error(existingErr.message || 'Failed to check existing games.')
  }
  const existingSlugs = new Set((existing ?? []).map((g: { slug: string }) => g.slug))

  const toInsert = valid.filter((v) => {
    if (existingSlugs.has(v.game.slug)) {
      result.errors.push({ row: v.row, message: `Duplicate slug: ${v.game.slug}` })
      return false
    }
    return true
  })
  if (toInsert.length === 0) return result

  const { data: inserted, error: insertErr } = await client
    .from('games')
    .insert(
      toInsert.map((v) => ({
        slug: v.game.slug,
        name: v.game.name,
        cover_url: v.game.coverUrl,
        attribution: v.game.attribution,
        genres: v.game.genres,
        release_year: v.game.releaseYear,
        developer: v.game.developer,
        publisher: v.game.publisher,
        steam_app_id: v.game.steamAppId,
        igdb_id: v.game.igdbId,
        ingest_status: 'skeleton',
      }))
    )
    .select('id, slug, name, cover_url, attribution, genres, release_year, developer, publisher, steam_app_id, igdb_id')
  if (insertErr) {
    console.error('[admin-moderation] bulk import insert error', insertErr)
    throw new Error(insertErr.message || 'Bulk import failed.')
  }

  type InsertedGameRow = {
    id: string
    slug: string
    name: string
    cover_url: string | null
    attribution: string | null
    genres: string[] | null
    release_year: number | null
    developer: string | null
    publisher: string | null
    steam_app_id: number | string | null
    igdb_id: number | string | null
  }
  const games: Game[] = ((inserted ?? []) as InsertedGameRow[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    coverImage: row.cover_url || '',
    coverAttribution: row.attribution ?? undefined,
    genres: row.genres ?? [],
    releaseYear: row.release_year ?? 0,
    developer: row.developer || 'Unknown',
    publisher: row.publisher ?? undefined,
    steamAppId: row.steam_app_id != null ? String(row.steam_app_id) : undefined,
    igdbId: row.igdb_id != null ? String(row.igdb_id) : undefined,
    ingestStatus: 'skeleton',
  }))
  result.success = games.length
  result.imported = games

  if (games.length > 0) {
    const { error: logErr } = await client.from('moderation_log').insert(
      games.map((g) => ({
        actor_id: actorId,
        target_type: 'game',
        target_id: g.id,
        action: 'bulk_import',
        new_status: 'skeleton',
        notes: g.slug,
      }))
    )
    if (logErr) console.warn('[admin-moderation] bulk import audit log failed (non-fatal):', logErr.message)
  }
  return result
}

// ---------------------------------------------------------------------------
// Overview stats (head-only counts, one round-trip each)
// ---------------------------------------------------------------------------

type CountQuery = ReturnType<ReturnType<SupabaseClient['from']>['select']>

async function headCount(
  client: SupabaseClient,
  table: string,
  apply?: (q: CountQuery) => CountQuery
): Promise<number> {
  let q = client.from(table).select('*', { count: 'exact', head: true })
  if (apply) q = apply(q)
  const { count, error } = await q
  if (error) {
    console.warn(`[admin-moderation] count ${table} failed:`, error.message)
    return 0
  }
  return count ?? 0
}

export async function getAdminOverviewStats(client: SupabaseClient): Promise<AdminOverviewStats> {
  const [totalReports, pendingReports, totalGames, pendingImages, hardwareAliases, importedGames] =
    await Promise.all([
      headCount(client, 'reports'),
      headCount(client, 'reports', (q) => q.eq('status', 'pending')),
      headCount(client, 'games'),
      headCount(client, 'report_images', (q) => q.eq('status', 'pending')),
      headCount(client, 'hardware_aliases'),
      headCount(client, 'moderation_log', (q) => q.eq('target_type', 'game').eq('action', 'bulk_import')),
    ])
  return { totalReports, pendingReports, totalGames, pendingImages, hardwareAliases, importedGames }
}

// ---------------------------------------------------------------------------
// Audit helper for direct table writes (aliases, imports). RPC paths log in SQL.
// ---------------------------------------------------------------------------

async function logModeration(
  client: SupabaseClient,
  actorId: string,
  targetType: 'hardware_alias' | 'game',
  targetId: string,
  action: string,
  previousStatus: string | null,
  newStatus: string | null
): Promise<void> {
  const { error } = await client.from('moderation_log').insert({
    actor_id: actorId,
    target_type: targetType,
    target_id: targetId,
    action,
    previous_status: previousStatus,
    new_status: newStatus,
  })
  if (error) console.warn('[admin-moderation] audit log failed (non-fatal):', error.message)
}
