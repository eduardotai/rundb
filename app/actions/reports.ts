'use server'

/**
 * RunDB Phase 2 Real Reports Server Actions
 * Aligned strictly with Master Implementation Plan + approved schema in supabase/schema.sql
 *
 * - Submission: status='pending', authoritative performance_tier calc, moderation fields defaulted
 * - Anti-abuse: rate limiting (5/hr for auth users) + duplicate detection (exact hardware match, 24h)
 * - Upvoting: uses report_votes (RLS + unique + trigger for helpful_votes maintained in schema)
 * - Moderation: role-checked updates for /admin/reports
 *
 * Prefer calling these over raw supabase in client code.
 * The optional submit_report / upvote_report RPCs in schema can be swapped in later.
 *
 * Agent 4 additions: protected ingestion trigger for /admin (pairs with ingest script + 18 games).
 */

import { createClient } from '@/lib/supabase/server'
import { getStaffAccess } from '@/lib/admin-access'
import { createServiceClient } from '@/lib/supabase/service'
import type { AdminReport, Report, SubmitReportInput, PerformanceTier, ReportStatus, GraphicsPreset } from '@/lib/types'
import { normalizeSlug } from '@/lib/utils'
import { normalizeHardwareSync } from '@/lib/normalize-hardware'

const REPORT_STATUSES: ReportStatus[] = ['pending', 'approved', 'rejected', 'flagged']

function assertReportStatus(status: ReportStatus): ReportStatus {
  if (!REPORT_STATUSES.includes(status)) {
    throw new Error('Invalid report status.')
  }
  return status
}

async function requireModerationAccess(): Promise<string> {
  const access = await getStaffAccess()
  if (!access.user || !access.canModerate) {
    throw new Error('Access denied. Moderator or admin role required.')
  }
  return access.user.id
}

function calculatePerformanceTier(avgFps: number): PerformanceTier {
  if (avgFps >= 90) return 'Excellent'
  if (avgFps >= 60) return 'Good'
  if (avgFps >= 40) return 'Playable'
  if (avgFps >= 25) return 'Struggling'
  return 'Unplayable'
}

function mapDbReportToReport(row: any): Report {
  return {
    id: row.id,
    gameId: row.game_id,
    gameName: row.game_name,
    cpu: row.cpu,
    gpu: row.gpu,
    ram: row.ram,
    ramSpeed: row.ram_speed,
    resolution: row.resolution,
    refreshRate: row.refresh_rate,
    settingsPreset: row.settings_preset as GraphicsPreset,
    customSettingsNotes: row.custom_settings_notes,
    avgFps: Number(row.avg_fps),
    fps1PercentLow: row.fps_1_percent_low != null ? Number(row.fps_1_percent_low) : undefined,
    performanceTier: row.performance_tier as PerformanceTier,
    notes: row.notes,
    tweaks: row.tweaks,
    issues: row.issues,
    driverVersion: row.driver_version,
    createdAt: row.created_at,
    helpfulVotes: row.helpful_votes ?? 0,
    // Moderation fields (populated for admin UI)
    status: row.status as ReportStatus,
    userId: row.user_id,
    moderatedBy: row.moderated_by,
    moderatedAt: row.moderated_at,
    moderatorNotes: row.moderator_notes,
  }
}

/**
 * Submit a performance report.
 * Respects approved schema exactly.
 * Anti-abuse enforced here (mirrors the submit_report RPC in schema.sql for defense-in-depth).
 */
export async function submitReportAction(input: SubmitReportInput): Promise<Report> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? null

  // 1. Validate game exists + get denormalized name
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .select('id, name')
    .eq('id', input.gameId)
    .single()

  if (gameErr || !game) {
    throw new Error('Game not found. Cannot submit report.')
  }

  const avgFps = input.avgFps
  if (typeof avgFps !== 'number' || !Number.isFinite(avgFps) || avgFps < 1 || avgFps > 600) {
    throw new Error('Average FPS must be a number between 1 and 600.')
  }
  const tier = calculatePerformanceTier(avgFps)

  // Hardware Catalog normalization (server-safe)
  const cpuNorm = normalizeHardwareSync(input.cpu)
  const gpuNorm = normalizeHardwareSync(input.gpu)

  // Basic plausibility note (future: full validation using perfIndex)
  let moderatorNotePrefix = ''
  if (cpuNorm.method === 'none' || gpuNorm.method === 'none') {
    moderatorNotePrefix = '[Catalog: unknown hardware] '
  }

  // 2. Anti-abuse checks (only for authenticated users; anon has lighter protection)
  if (userId) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: recentCount } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo)

    if ((recentCount ?? 0) >= 5) {
      throw new Error('Rate limit exceeded: You can submit a maximum of 5 reports per hour.')
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: dupCount } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('game_id', input.gameId)
      .eq('cpu', input.cpu)
      .eq('gpu', input.gpu)
      .eq('ram', input.ram)
      .eq('resolution', input.resolution)
      .gte('created_at', oneDayAgo)

    if ((dupCount ?? 0) > 0) {
      throw new Error('Duplicate report detected: You submitted a nearly identical report for this game + hardware combination within the last 24 hours.')
    }
  }

  // 3. Insert (schema defaults: status='pending', helpful_votes=0, moderation fields=NULL)
  const insertPayload = {
    game_id: input.gameId,
    user_id: userId,
    game_name: game.name,
    cpu: input.cpu,
    gpu: input.gpu,
    ram: input.ram,
    ram_speed: input.ramSpeed ?? null,
    resolution: input.resolution,
    refresh_rate: input.refreshRate ?? null,
    settings_preset: input.settingsPreset,
    custom_settings_notes: input.customSettingsNotes ?? null,
    avg_fps: avgFps,
    fps_1_percent_low: input.fps1PercentLow ?? null,
    performance_tier: tier,
    notes: (moderatorNotePrefix + (input.notes ?? '')).trim() || null,
    tweaks: input.tweaks ?? null,
    issues: input.issues ?? null,
    driver_version: input.driverVersion ?? null,
    // Hardware catalog denorm (future indexes + validation)
    // Note: columns are optional in current schema; safe to send
    // canonical_cpu: cpuNorm.canonical,
    // canonical_gpu: gpuNorm.canonical,
    // status, created_at, helpful_votes, moderated_* defaulted by schema / DB
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('reports')
    .insert(insertPayload)
    .select('*')
    .single()

  if (insertErr || !inserted) {
    console.error('[submitReportAction] insert error', insertErr)
    throw new Error(insertErr?.message || 'Failed to submit report. Please try again.')
  }

  // 4. Return mapped (status will be 'pending')
  return mapDbReportToReport(inserted)
}

/**
 * Upvote a report (authenticated only).
 * Leverages report_votes table + trigger (see schema.sql).
 * Duplicate prevented by UNIQUE constraint + RLS.
 */
export async function upvoteReportAction(reportId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('You must sign in to upvote reports.')
  }

  const { error } = await supabase
    .from('report_votes')
    .insert({ report_id: reportId, user_id: user.id })

  if (error) {
    if (error.code === '23505' || error.message?.includes('duplicate')) {
      throw new Error('You have already upvoted this report.')
    }
    console.error('[upvoteReportAction] error', error)
    throw new Error('Failed to register upvote. Please try again.')
  }
  // helpful_votes is auto-updated by trg_report_votes_count trigger. No further action needed.
}

/**
 * Moderation action for /admin/reports.
 * Server-side role check (even if UI also checks).
 * Updates status + moderation audit fields.
 */
export async function moderateReportAction(
  reportId: string,
  newStatus: ReportStatus,
  moderatorNotes?: string
): Promise<void> {
  const status = assertReportStatus(newStatus)
  const moderatorId = await requireModerationAccess()
  const supabase = createServiceClient()

  const updatePayload: {
    status: ReportStatus
    moderated_by: string
    moderated_at: string
    moderator_notes?: string | null
  } = {
    status,
    moderated_by: moderatorId,
    moderated_at: new Date().toISOString(),
  }
  if (moderatorNotes !== undefined) {
    updatePayload.moderator_notes = moderatorNotes.trim() || null
  }

  const { data: updated, error: updateErr } = await supabase
    .from('reports')
    .update(updatePayload)
    .eq('id', reportId)
    .select('id')
    .single()

  if (updateErr || !updated) {
    console.error('[moderateReportAction] update error', updateErr)
    throw new Error(updateErr?.message || 'Failed to update report status.')
  }
}

/**
 * Fetch the real moderation queue for /admin.
 * Uses service-role reads only after staff authorization, so pending/rejected rows
 * are visible without exposing privileged records to arbitrary clients.
 */
export async function getModerationQueueAction(
  filterStatus?: ReportStatus | 'all'
): Promise<AdminReport[]> {
  await requireModerationAccess()
  const supabase = createServiceClient()

  const statusFilter =
    filterStatus && filterStatus !== 'all' ? assertReportStatus(filterStatus) : null

  let query = supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query

  if (error) {
    console.error('[getModerationQueueAction] select error', error)
    throw new Error(error.message || 'Failed to load moderation queue.')
  }

  return (data || [])
    .map((row) => mapDbReportToReport(row) as AdminReport)
    .sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1
      if (a.status !== 'pending' && b.status === 'pending') return 1
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
}

/**
 * Optional helper: fetch a single report (used by admin UI).
 * Relies on moderator RLS policy added in Phase 2 SQL.
 */
export async function getReportByIdForMod(reportId: string): Promise<Report | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', reportId)
    .single()

  if (error || !data) return null
  return mapDbReportToReport(data)
}

/**
 * Agent 4 / PR 4: Protected Server Action for game ingestion + admin tooling.
 * Enforces real Supabase profile.role === 'admin' (defense in depth; mirrors moderateReportAction).
 * Normalizes seeds using shared normalizeSlug for clean handling of the exact 18 games.
 * Returns normalized list + auth summary. Real heavy lifting (IGDB + Storage) stays in
 * scripts/ingest-games.ts (callable via generated command or future queue). Button in /admin
 * uses this for protected trigger + preview.
 */
export async function triggerIngestionAction(
  seedList?: Array<{ name: string; slug?: string }>
): Promise<{
  ok: boolean
  authorized: boolean
  count: number
  normalizedSeeds: Array<{ name: string; slug: string }>
  message: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Authentication required to trigger game ingestion.')
  }

  // Role check (admin only, like moderation). Relies on profiles.role from schema.
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile || profile.role !== 'admin') {
    throw new Error('Access denied. Admin role required for ingestion tooling.')
  }

  const input = Array.isArray(seedList) ? seedList : []
  const normalizedSeeds = input
    .map((s) => {
      const name = String(s?.name || '').trim()
      if (!name) return null
      const slug = String(s?.slug || '').trim() || normalizeSlug(name)
      return { name, slug }
    })
    .filter((x): x is { name: string; slug: string } => !!x)

  return {
    ok: true,
    authorized: true,
    count: normalizedSeeds.length,
    normalizedSeeds,
    message: normalizedSeeds.length > 0
      ? `Admin authorized. ${normalizedSeeds.length} normalized seeds ready for ingest script or bulk.`
      : 'Admin authorized. No seeds provided (use default 18 in script). Run via CLI with SEED_JSON or --admin-trigger.',
  }
}
