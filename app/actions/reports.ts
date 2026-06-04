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

function calculatePerformanceTier(avgFps: number): PerformanceTier {
  if (avgFps >= 90) return 'Excellent'
  if (avgFps >= 60) return 'Good'
  if (avgFps >= 40) return 'Playable'
  if (avgFps >= 25) return 'Struggling'
  return 'Unplayable'
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

/**
 * Submit a performance report.
 * Respects approved schema exactly.
 * Anti-abuse enforced here (mirrors the submit_report RPC in schema.sql for defense-in-depth).
 */
export async function submitReportAction(input: SubmitReportInput): Promise<Report> {
  try {
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

    // Hardware Catalog normalization (server-safe). Used ONLY for the moderator
    // "unknown hardware" hint below — we deliberately persist the user's EXACT typed
    // CPU/GPU strings so reports display the hardware exactly as the reporter entered
    // it. The similarity engine normalizes on the fly (getPerfIndexForRaw), so matching
    // is unaffected by storing the raw values rather than the canonical form.
    const cpuNorm = normalizeHardwareSync(input.cpu)
    const gpuNorm = normalizeHardwareSync(input.gpu)
    const storedCpu = input.cpu.trim()
    const storedGpu = input.gpu.trim()

    // Basic plausibility note (future: full validation using perfIndex)
    let moderatorNotePrefix = ''
    if (cpuNorm.method === 'none' || gpuNorm.method === 'none') {
      moderatorNotePrefix = '[Catalog: unknown hardware]'
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
        .eq('cpu', storedCpu)
        .eq('gpu', storedGpu)
        .eq('ram', input.ram)
        .eq('resolution', input.resolution)
        .gte('created_at', oneDayAgo)

      if ((dupCount ?? 0) > 0) {
        throw new Error('Duplicate report detected: You submitted a nearly identical report for this game + hardware combination within the last 24 hours.')
      }
    }

    // 3. Insert. Reports publish automatically; vote/downvote scoring can later flag bad reports.
    const insertPayload = {
      game_id: input.gameId,
      user_id: userId,
      game_name: game.name,
      cpu: storedCpu,
      gpu: storedGpu,
      ram: input.ram,
      ram_speed: input.ramSpeed ?? null,
      resolution: input.resolution,
      refresh_rate: input.refreshRate ?? null,
      settings_preset: input.settingsPreset,
      custom_settings_notes: input.customSettingsNotes ?? null,
      avg_fps: avgFps,
      fps_1_percent_low: input.fps1PercentLow ?? null,
      performance_tier: tier,
      notes: input.notes?.trim() || null,
      tweaks: input.tweaks ?? null,
      issues: input.issues ?? null,
      driver_version: input.driverVersion ?? null,
      moderator_notes: moderatorNotePrefix || null,
      // Hardware catalog denorm (future indexes + validation)
      // Note: columns are optional in current schema; safe to send
      // canonical_cpu: cpuNorm.canonical,
      // canonical_gpu: gpuNorm.canonical,
      status: 'approved' as ReportStatus,
      // created_at, vote counters, moderated_* defaulted by schema / DB
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

    // 4. Return mapped (status is live immediately unless DB-side automation changes it)
    return mapDbReportToReport(inserted)
  } catch (err: any) {
    // Ensure every code path results in a thrown Error with message (never raw unhandled
    // exception or rejected promise from supabase fetch). This prevents Next.js from
    // returning opaque 500 for the server action, which manifests as "Failed to fetch"
    // + 500 resource errors (and SW-uncaught variants) on the client.
    console.error('[submitReportAction] error', err)
    if (err?.message && (
      err.message.includes('Game not found') ||
      err.message.includes('Rate limit') ||
      err.message.includes('Duplicate') ||
      err.message.includes('Average FPS')
    )) {
      throw err
    }
    throw new Error(err?.message || 'Failed to submit report. Please try again.')
  }
}

/**
 * Editable subset of a report. Owners may correct these after submission (e.g. the game
 * patched and FPS changed, or they fixed a typo). Identity-bound fields (game, user,
 * status, vote counts, moderation) are deliberately excluded.
 */
export interface UpdateReportInput {
  cpu: string
  gpu: string
  ram: number
  ramSpeed?: string | null
  resolution: string
  refreshRate?: number | null
  settingsPreset: GraphicsPreset
  customSettingsNotes?: string | null
  avgFps: number
  fps1PercentLow?: number | null
  notes?: string | null
  tweaks?: string | null
  issues?: string | null
  driverVersion?: string | null
}

const GRAPHICS_PRESETS: GraphicsPreset[] = ['Low', 'Medium', 'High', 'Ultra', 'Custom']

/** Trim a free-text field to a null-or-value, capped at `max` chars (defense in depth). */
function cleanText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null
  const t = String(value).trim()
  if (!t) return null
  return t.slice(0, max)
}

/**
 * Edit one of the current user's own reports (post-submission corrections).
 *
 * Ownership is verified in-code before any write, then the update is performed with the
 * service client constrained by `user_id`. This is required because reports publish as
 * `status='approved'` while the owner-update RLS policy only covers `status='pending'`
 * (schema.sql) — so a user-scoped update would silently match zero rows for live reports.
 * The same "verify-then-service-write" pattern is used by moderateReportAction.
 *
 * performance_tier is always recomputed server-side from the (possibly new) avgFps so the
 * authoritative tier can never drift from the number. game_id / game_name / user_id /
 * status / vote counters / moderation fields are never touched.
 */
export async function updateReportAction(reportId: string, input: UpdateReportInput): Promise<Report> {
  try {
    if (!reportId || typeof reportId !== 'string') {
      throw new Error('Missing report id.')
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('You must sign in to edit a report.')
    }

    // Ownership check via the user-scoped client (RLS lets a user read their own reports
    // at any status). A missing row here means "not yours / doesn't exist" — same opaque
    // message either way so we never confirm the existence of someone else's report.
    const { data: existing, error: readErr } = await supabase
      .from('reports')
      .select('id, user_id')
      .eq('id', reportId)
      .maybeSingle()

    if (readErr) {
      console.error('[updateReportAction] read error', readErr)
      throw new Error('Could not load the report to edit. Please try again.')
    }
    if (!existing || existing.user_id !== user.id) {
      throw new Error('You can only edit your own reports.')
    }

    // Validate + recompute authoritative tier (mirrors submitReportAction).
    const avgFps = Number(input.avgFps)
    if (!Number.isFinite(avgFps) || avgFps < 1 || avgFps > 600) {
      throw new Error('Average FPS must be a number between 1 and 600.')
    }
    const tier = calculatePerformanceTier(avgFps)

    const ram = Number(input.ram)
    if (!Number.isFinite(ram) || ram < 2 || ram > 256) {
      throw new Error('RAM must be between 2 and 256 GB.')
    }

    const storedCpu = String(input.cpu ?? '').trim()
    const storedGpu = String(input.gpu ?? '').trim()
    if (storedCpu.length < 2 || storedGpu.length < 2) {
      throw new Error('CPU and GPU are required.')
    }

    if (!GRAPHICS_PRESETS.includes(input.settingsPreset)) {
      throw new Error('Invalid graphics preset.')
    }

    const onePctLow = input.fps1PercentLow != null && input.fps1PercentLow !== ('' as unknown)
      ? Number(input.fps1PercentLow)
      : null
    if (onePctLow != null && (!Number.isFinite(onePctLow) || onePctLow <= 0)) {
      throw new Error('1% low FPS must be a positive number.')
    }

    const refreshRate = input.refreshRate != null && input.refreshRate !== ('' as unknown)
      ? Number(input.refreshRate)
      : null
    if (refreshRate != null && (!Number.isFinite(refreshRate) || refreshRate < 30 || refreshRate > 1000)) {
      throw new Error('Refresh rate must be between 30 and 1000 Hz.')
    }

    const updatePayload = {
      cpu: storedCpu,
      gpu: storedGpu,
      ram,
      ram_speed: cleanText(input.ramSpeed, 20),
      resolution: String(input.resolution ?? '').trim(),
      refresh_rate: refreshRate,
      settings_preset: input.settingsPreset,
      // Custom notes only meaningful for the Custom preset; clear otherwise.
      custom_settings_notes: input.settingsPreset === 'Custom' ? cleanText(input.customSettingsNotes, 300) : null,
      avg_fps: avgFps,
      fps_1_percent_low: onePctLow,
      performance_tier: tier,
      notes: cleanText(input.notes, 500),
      tweaks: cleanText(input.tweaks, 300),
      issues: cleanText(input.issues, 500),
      driver_version: cleanText(input.driverVersion, 40),
    }

    // Service-client write, still scoped to this user's row as defense in depth.
    const service = createServiceClient()
    const { data: updated, error: updateErr } = await service
      .from('reports')
      .update(updatePayload)
      .eq('id', reportId)
      .eq('user_id', user.id)
      .select('*')
      .single()

    if (updateErr || !updated) {
      console.error('[updateReportAction] update error', updateErr)
      throw new Error(updateErr?.message || 'Failed to save changes. Please try again.')
    }

    return mapDbReportToReport(updated)
  } catch (err: any) {
    console.error('[updateReportAction] error', err)
    if (err?.message && (
      err.message.includes('sign in') ||
      err.message.includes('own reports') ||
      err.message.includes('Average FPS') ||
      err.message.includes('RAM must') ||
      err.message.includes('required') ||
      err.message.includes('preset') ||
      err.message.includes('1% low') ||
      err.message.includes('Refresh rate') ||
      err.message.includes('report id')
    )) {
      throw err
    }
    throw new Error(err?.message || 'Failed to save changes. Please try again.')
  }
}

/**
 * Cast or clear a signed vote on a report (authenticated only).
 * Leverages report_votes table + trigger (see schema.sql).
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
