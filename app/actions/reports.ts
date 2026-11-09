'use server'

/**
 * RunDB Phase 2 Real Reports Server Actions
 * Aligned strictly with Master Implementation Plan + approved schema in supabase/migrations
 *
 * - Submission/edit: lib/server/report-write.ts (strict zod schema from lib/report-input.ts,
 *   auth, ownership, 5/hr rate limit, 24h duplicate check, auto-review to 'pending' for
 *   implausible reports); service-role writes
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
import type { AdminReport, Report, PerformanceTier, ReportStatus, GraphicsPreset } from '@/lib/types'
import { normalizeSlug } from '@/lib/utils'
import { submitReport, updateReport, type ReportWriteDeps } from '@/lib/server/report-write'
import { cleanPublicReportNotes } from '@/lib/report-notes'
import type { User } from '@supabase/supabase-js'

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

function isRegisteredUser(user: User | null): boolean {
  return Boolean(user?.id && user.email && !user.is_anonymous)
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
    notes: cleanPublicReportNotes(row.notes),
    tweaks: row.tweaks,
    issues: row.issues,
    driverVersion: row.driver_version,
    createdAt: row.created_at,
    helpfulVotes: row.helpful_votes ?? 0,
    downvoteVotes: row.downvote_votes ?? 0,
    voteScore: row.vote_score ?? row.helpful_votes ?? 0,
    credibilityScore: row.credibility_score,
    credibilityBadge: row.credibility_badge,
    canonicalCpu: row.canonical_cpu,
    canonicalGpu: row.canonical_gpu,
    gpuPerfIndex: row.gpu_perf_index != null ? Number(row.gpu_perf_index) : undefined,
    cpuPerfIndex: row.cpu_perf_index != null ? Number(row.cpu_perf_index) : undefined,
    // Moderation fields (populated for admin UI)
    status: row.status as ReportStatus,
    userId: row.user_id,
    moderatedBy: row.moderated_by,
    moderatedAt: row.moderated_at,
    moderatorNotes: row.moderator_notes,
  }
}

/** Expected-failure result. Next.js hides thrown messages in production, so actions return errors. */
export type ReportActionResult = { ok: true; report: Report } | { ok: false; error: string }

/**
 * Wire lib/server/report-write.ts to real clients. Reads that must respect the caller's
 * RLS (game lookup, own-report ownership, rate-limit counts) use the cookie client; writes use
 * the service client because client INSERT/UPDATE on reports is revoked (see
 * supabase/migrations/20261109000500_security_hardening.sql). The service writes are always
 * scoped to the authenticated user's id.
 */
async function buildReportWriteDeps(): Promise<{ deps: ReportWriteDeps<any>; getAuthUser: () => User | null }> {
  const supabase = await createClient()
  const service = createServiceClient()
  let authUser: User | null = null

  const deps: ReportWriteDeps<any> = {
    async getUser() {
      const { data: { user } } = await supabase.auth.getUser()
      authUser = user ?? null
      return user ? { id: user.id, email: user.email ?? null, is_anonymous: user.is_anonymous ?? null } : null
    },
    async isStaff() {
      const access = await getStaffAccess()
      return Boolean(access.user && access.canModerate)
    },
    async findGame(gameId) {
      const { data, error } = await supabase.from('games').select('id, name').eq('id', gameId).maybeSingle()
      if (error) console.error('[reports] game lookup error', error)
      return data ? { id: String(data.id), name: String(data.name) } : null
    },
    async countReportsSince(userId, sinceIso) {
      const { count, error } = await supabase
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', sinceIso)
      if (error) throw new Error(`rate-limit count failed: ${error.message}`)
      return count ?? 0
    },
    async countDuplicates(q) {
      const { count, error } = await supabase
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', q.userId)
        .eq('game_id', q.gameId)
        .eq('cpu', q.cpu)
        .eq('gpu', q.gpu)
        .eq('ram', q.ram)
        .eq('resolution', q.resolution)
        .gte('created_at', q.sinceIso)
      if (error) throw new Error(`duplicate count failed: ${error.message}`)
      return count ?? 0
    },
    async insertReport(row) {
      const { data, error } = await service.from('reports').insert(row).select('*').single()
      if (error) console.error('[reports] insert error', error)
      return data ?? null
    },
    async findReport(reportId) {
      const { data, error } = await supabase
        .from('reports')
        .select('id, user_id, status, moderator_notes')
        .eq('id', reportId)
        .maybeSingle()
      if (error) throw new Error(`report lookup failed: ${error.message}`)
      return data ?? null
    },
    async updateOwnReport(reportId, userId, row) {
      const { data, error } = await service
        .from('reports')
        .update(row)
        .eq('id', reportId)
        .eq('user_id', userId)
        .select('*')
        .single()
      if (error) console.error('[reports] update error', error)
      return data ?? null
    },
    now: () => Date.now(),
  }
  return { deps, getAuthUser: () => authUser }
}

/**
 * Make sure the reporter's public nickname exists so report cards can show "by Nick".
 * Sign-up stores username in auth user_metadata; profiles.username may still be empty.
 */
async function syncReporter(user: User): Promise<NonNullable<Report['reporter']>> {
  const service = createServiceClient()
  const meta = (user.user_metadata ?? {}) as { username?: unknown; avatar_url?: unknown }
  const metaUsername = typeof meta.username === 'string' ? meta.username.trim() : ''
  const reporter: NonNullable<Report['reporter']> = {
    id: user.id,
    username: metaUsername || null,
    avatarUrl: typeof meta.avatar_url === 'string' ? meta.avatar_url : null,
    credibilityBadge: null,
  }
  try {
    const { data: existingProf } = await service
      .from('profiles')
      .select('username, avatar_url, credibility_badge')
      .eq('id', user.id)
      .maybeSingle()
    const existingName = typeof existingProf?.username === 'string' ? existingProf.username.trim() : ''
    if (existingName) {
      reporter.username = existingName
    } else if (metaUsername) {
      await service.from('profiles').upsert({ id: user.id, username: metaUsername })
    }
    if (existingProf?.avatar_url) reporter.avatarUrl = String(existingProf.avatar_url)
    if (existingProf?.credibility_badge) {
      reporter.credibilityBadge = existingProf.credibility_badge as import('@/lib/types').CredibilityBadge
    }
  } catch (syncErr: any) {
    console.warn('[submitReportAction] profile username sync failed (non-fatal):', syncErr?.message || syncErr)
  }
  return reporter
}

/**
 * Submit a performance report (public endpoint: everything is re-validated server-side).
 * See lib/server/report-write.ts for the order of checks and the auto-review rule.
 * Returns `status: 'pending'` when the report was held for moderator review.
 */
export async function submitReportAction(input: unknown): Promise<ReportActionResult> {
  try {
    const { deps, getAuthUser } = await buildReportWriteDeps()
    const result = await submitReport(deps, input)
    if (!result.ok) return result
    const mapped = mapDbReportToReport(result.value)
    const user = getAuthUser()
    if (user) mapped.reporter = await syncReporter(user)
    return { ok: true, report: mapped }
  } catch (err) {
    console.error('[submitReportAction] error', err)
    return { ok: false, error: 'Failed to submit report. Please try again.' }
  }
}

/**
 * Edit one of the caller's own reports (post-submission corrections).
 * Ownership is checked with the RLS-scoped client, then the write uses the service client
 * scoped to `user_id`. game_id / user_id / vote counters are never touched; status only
 * moves approved -> pending when the edit fails auto-review.
 */
export async function updateReportAction(reportId: unknown, input: unknown): Promise<ReportActionResult> {
  try {
    const { deps } = await buildReportWriteDeps()
    const result = await updateReport(deps, reportId, input)
    if (!result.ok) return result
    return { ok: true, report: mapDbReportToReport(result.value) }
  } catch (err) {
    console.error('[updateReportAction] error', err)
    return { ok: false, error: 'Failed to save changes. Please try again.' }
  }
}

/**
 * Cast or clear a signed vote on a report (authenticated only).
 * Leverages report_votes table + trigger (see supabase/migrations).
 * - value 1 / -1: upsert the vote (duplicate prevented by UNIQUE constraint + RLS).
 * - value 0: remove the user's existing vote (the DELETE RLS policy allows owners).
 * Vote counters + reporter reputation are auto-updated by DB triggers/functions.
 */
export async function voteReportAction(reportId: string, value: 1 | -1 | 0): Promise<void> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!isRegisteredUser(user)) {
      throw new Error('You must sign in to vote on reports.')
    }

    const { error } = value === 0
      ? await supabase
          .from('report_votes')
          .delete()
          .eq('report_id', reportId)
          .eq('user_id', user.id)
      : await supabase
          .from('report_votes')
          .upsert(
            { report_id: reportId, user_id: user.id, vote: value },
            { onConflict: 'report_id,user_id' }
          )

    if (error) {
      console.error('[voteReportAction] error', error)
      // 42501 = RLS rejected the row: the report belongs to the voter (self-votes are blocked in the DB).
      if (error.code === '42501') {
        throw new Error("You can't vote on your own report.")
      }
      throw new Error('Failed to register vote. Please try again.')
    }
  } catch (err: any) {
    console.error('[voteReportAction] error', err)
    if (err?.message?.includes('sign in')) {
      throw err
    }
    throw new Error(err?.message || 'Failed to register vote. Please try again.')
  }
}

export async function upvoteReportAction(reportId: string): Promise<void> {
  return voteReportAction(reportId, 1)
}

export async function downvoteReportAction(reportId: string): Promise<void> {
  return voteReportAction(reportId, -1)
}

/** Remove the current user's vote on a report (undo an upvote/downvote). */
export async function removeVoteReportAction(reportId: string): Promise<void> {
  return voteReportAction(reportId, 0)
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

  // Routed through the audited moderate_reports RPC (supabase/migrations/20261109000400_admin_moderation.sql).
  const { moderateReports } = await import('@/lib/server/admin-moderation')
  const updated = await moderateReports(createServiceClient(), moderatorId, [reportId], status, moderatorNotes)
  if (updated === 0) {
    throw new Error('Report not found.')
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
    .rpc('get_my_profile')
    .select('role')
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
