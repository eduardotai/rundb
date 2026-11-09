/**
 * Server-side core for creating and editing performance reports.
 *
 * app/actions/reports.ts wires these to real Supabase clients; tests pass in-memory
 * fakes (tests/report-write.test.ts). Server actions are public HTTP endpoints, so every
 * rule a browser form enforces is re-checked here:
 *
 * 1. auth (registered, non-anonymous user)
 * 2. strict schema (lib/report-input.ts): types, ranges, enums, lengths, unknown keys rejected
 * 3. game exists (submit) / caller owns the report (edit)
 * 4. anti-abuse (submit): max REPORTS_PER_HOUR per user + 24h exact-duplicate check
 * 5. auto-review: plausible reports publish immediately; implausible ones wait as 'pending'
 *
 * Expected failures are returned as `{ ok: false, error }` (never thrown) because Next.js
 * hides thrown error messages from the client in production builds.
 */
import type { PerformanceTier, ReportStatus } from '@/lib/types'
import {
  assessReportPlausibility,
  autoReviewNote,
  calculatePerformanceTier,
  formatReportInputError,
  reportIdSchema,
  submitReportInputSchema,
  updateReportInputSchema,
} from '@/lib/report-input'

export const REPORTS_PER_HOUR = 5
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export type WriteResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface ReportWriter {
  id: string
  email?: string | null
  is_anonymous?: boolean | null
}

/** Columns written for a report (shared by insert and update). */
export interface ReportContentRow {
  cpu: string
  gpu: string
  ram: number
  ram_speed: string | null
  resolution: string
  refresh_rate: number | null
  settings_preset: string
  custom_settings_notes: string | null
  avg_fps: number
  fps_1_percent_low: number | null
  performance_tier: PerformanceTier
  notes: string | null
  tweaks: string | null
  issues: string | null
  driver_version: string | null
}

export interface ReportInsertRow extends ReportContentRow {
  game_id: string
  user_id: string
  game_name: string
  status: ReportStatus
  moderator_notes: string | null
}

export interface ReportUpdateRow extends ReportContentRow {
  status?: ReportStatus
  moderator_notes?: string | null
}

export interface OwnReport {
  id: string
  user_id: string
  status: ReportStatus
  moderator_notes: string | null
}

/** Everything the core needs from the outside world. */
export interface ReportWriteDeps<Row> {
  getUser(): Promise<ReportWriter | null>
  /** Moderators/admins publish without auto-review. */
  isStaff(): Promise<boolean>
  findGame(gameId: string): Promise<{ id: string; name: string } | null>
  countReportsSince(userId: string, sinceIso: string): Promise<number>
  countDuplicates(q: {
    userId: string
    gameId: string
    cpu: string
    gpu: string
    ram: number
    resolution: string
    sinceIso: string
  }): Promise<number>
  insertReport(row: ReportInsertRow): Promise<Row | null>
  /** Reads a report the caller can see (RLS-scoped). null when missing/invisible. */
  findReport(reportId: string): Promise<OwnReport | null>
  updateOwnReport(reportId: string, userId: string, row: ReportUpdateRow): Promise<Row | null>
  now(): number
}

function isRegistered(user: ReportWriter | null): user is ReportWriter {
  return Boolean(user?.id && user.email && !user.is_anonymous)
}

function contentRow(f: {
  cpu: string
  gpu: string
  ram: number
  ramSpeed?: string
  resolution: string
  refreshRate?: number
  settingsPreset: string
  customSettingsNotes?: string
  avgFps: number
  fps1PercentLow?: number
  notes?: string
  tweaks?: string
  issues?: string
  driverVersion?: string
}): ReportContentRow {
  return {
    cpu: f.cpu,
    gpu: f.gpu,
    ram: f.ram,
    ram_speed: f.ramSpeed ?? null,
    resolution: f.resolution,
    refresh_rate: f.refreshRate ?? null,
    settings_preset: f.settingsPreset,
    custom_settings_notes: f.customSettingsNotes ?? null,
    avg_fps: f.avgFps,
    fps_1_percent_low: f.fps1PercentLow ?? null,
    performance_tier: calculatePerformanceTier(f.avgFps),
    notes: f.notes ?? null,
    tweaks: f.tweaks ?? null,
    issues: f.issues ?? null,
    driver_version: f.driverVersion ?? null,
  }
}

export async function submitReport<Row>(deps: ReportWriteDeps<Row>, raw: unknown): Promise<WriteResult<Row>> {
  const user = await deps.getUser()
  if (!isRegistered(user)) return { ok: false, error: 'You must sign in to submit a report.' }

  const parsed = submitReportInputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: formatReportInputError(parsed.error) }
  const input = parsed.data

  const game = await deps.findGame(input.gameId)
  if (!game) return { ok: false, error: 'Game not found. Cannot submit report.' }

  const now = deps.now()
  const recent = await deps.countReportsSince(user.id, new Date(now - HOUR_MS).toISOString())
  if (recent >= REPORTS_PER_HOUR) {
    return { ok: false, error: `Rate limit reached: you can submit up to ${REPORTS_PER_HOUR} reports per hour. Please try again later.` }
  }

  const duplicates = await deps.countDuplicates({
    userId: user.id,
    gameId: input.gameId,
    cpu: input.cpu,
    gpu: input.gpu,
    ram: input.ram,
    resolution: input.resolution,
    sinceIso: new Date(now - DAY_MS).toISOString(),
  })
  if (duplicates > 0) {
    return {
      ok: false,
      error: 'Duplicate report: you already submitted this game with the same hardware and resolution in the last 24 hours.',
    }
  }

  const reasons = assessReportPlausibility(input, raw)
  const held = reasons.length > 0 && !(await deps.isStaff())

  const inserted = await deps.insertReport({
    ...contentRow(input),
    game_id: game.id,
    user_id: user.id,
    game_name: game.name,
    status: held ? 'pending' : 'approved',
    moderator_notes: reasons.length > 0 ? autoReviewNote(reasons) : null,
  })
  if (!inserted) return { ok: false, error: 'Failed to submit report. Please try again.' }
  return { ok: true, value: inserted }
}

export async function updateReport<Row>(
  deps: ReportWriteDeps<Row>,
  reportId: unknown,
  raw: unknown,
): Promise<WriteResult<Row>> {
  const id = reportIdSchema.safeParse(reportId)
  if (!id.success) return { ok: false, error: 'Missing report id.' }

  const user = await deps.getUser()
  if (!isRegistered(user)) return { ok: false, error: 'You must sign in to edit a report.' }

  // Same message for "missing" and "someone else's" so we never confirm another user's report exists.
  const existing = await deps.findReport(id.data)
  if (!existing || existing.user_id !== user.id) return { ok: false, error: 'You can only edit your own reports.' }

  const parsed = updateReportInputSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: formatReportInputError(parsed.error) }

  const row: ReportUpdateRow = contentRow(parsed.data)

  // An edit can turn a published report implausible (e.g. FPS -> 599, link added): send it back
  // to review. Edits never promote: pending/rejected/flagged keep their status.
  const reasons = assessReportPlausibility(parsed.data, raw)
  if (existing.status === 'approved' && reasons.length > 0 && !(await deps.isStaff())) {
    const note = autoReviewNote(reasons)
    row.status = 'pending'
    row.moderator_notes = existing.moderator_notes ? `${existing.moderator_notes}\n${note}` : note
  }

  const updated = await deps.updateOwnReport(id.data, user.id, row)
  if (!updated) return { ok: false, error: 'Failed to save changes. Please try again.' }
  return { ok: true, value: updated }
}
