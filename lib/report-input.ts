/**
 * Shared validation for performance-report input (submit + edit).
 *
 * One field definition, three consumers:
 * - `reportFormSchema` / `reportEditFormSchema`: react-hook-form resolvers in
 *   components/submit-report-dialog.tsx and components/my-reports/edit-report-dialog.tsx.
 * - `submitReportInputSchema` / `updateReportInputSchema`: the server-side gate in
 *   lib/server/report-write.ts. Server actions are public endpoints, so this is the
 *   authoritative check; the client copy is only for fast feedback.
 *
 * Server schemas are strict: unknown keys (status, user_id, helpful_votes, ...) are
 * rejected instead of silently dropped, so a tampered payload fails loudly.
 *
 * Pure module (no server imports) so it can run in the browser, the server and tests.
 */
import * as z from 'zod'
import { sanitizeFullName } from '@/lib/sanitize'
import { normalizeHardwareSync } from '@/lib/normalize-hardware'
import type { GraphicsPreset, PerformanceTier } from '@/lib/types'

export const GRAPHICS_PRESETS = ['Low', 'Medium', 'High', 'Ultra', 'Custom'] as const satisfies readonly GraphicsPreset[]

export const REPORT_LIMITS = {
  hardwareMin: 2,
  hardwareMax: 80,
  ramMinGb: 2,
  ramMaxGb: 256,
  ramSpeedMax: 20,
  fpsMin: 1,
  fpsMax: 600,
  refreshMinHz: 30,
  refreshMaxHz: 1000,
  customSettingsMax: 300,
  notesMax: 500,
  issuesMax: 500,
  tweaksMax: 300,
  driverMax: 40,
  /** Detection metadata the client forwards (kernel, distro, canonical names). Not stored. */
  metaMax: 120,
  resolutionMinWidth: 320,
  resolutionMaxWidth: 15360,
  resolutionMinHeight: 200,
  resolutionMaxHeight: 8640,
} as const

/** Average FPS above this is possible (esports titles, frame generation) but rare: a human checks it. */
export const AUTO_REVIEW_FPS_THRESHOLD = 360

const DECIMAL = /^\s*-?\d+(\.\d+)?\s*$/

/** '' / null / NaN mean "not provided"; numeric strings from <input> become numbers. Anything else is left for z.number() to reject. */
function toOptionalNumber(value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return undefined
  if (typeof value === 'number' && Number.isNaN(value)) return undefined
  if (typeof value === 'string') return DECIMAL.test(value) ? Number(value) : value
  return value
}

function toRequiredNumber(value: unknown): unknown {
  if (typeof value === 'string' && DECIMAL.test(value)) return Number(value)
  return value
}

function toOptionalString(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  return value
}

function requiredNumber(label: string, min: number, max: number, opts: { int?: boolean } = {}) {
  let n = z.number({ error: `${label} must be a number.` })
  if (opts.int) n = n.int(`${label} must be a whole number.`)
  return z.preprocess(
    toRequiredNumber,
    n.min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`),
  )
}

function optionalNumber(label: string, min: number, max: number, opts: { int?: boolean; exclusiveMin?: boolean } = {}) {
  let n = z.number({ error: `${label} must be a number.` })
  if (opts.int) n = n.int(`${label} must be a whole number.`)
  n = opts.exclusiveMin
    ? n.gt(min, `${label} must be greater than ${min}.`)
    : n.min(min, `${label} must be at least ${min}.`)
  return z.preprocess(toOptionalNumber, n.max(max, `${label} must be at most ${max}.`).optional())
}

/** Required hardware name: sanitized, 2-80 chars after sanitizing. */
function hardwareName(label: string) {
  return z
    .string({ error: `${label} is required.` })
    .max(REPORT_LIMITS.hardwareMax, `${label} name is too long (max ${REPORT_LIMITS.hardwareMax} characters).`)
    .transform((v) => sanitizeFullName(v, REPORT_LIMITS.hardwareMax))
    .pipe(z.string().min(REPORT_LIMITS.hardwareMin, `${label} is required.`))
}

/** Optional free text: sanitized, capped, '' -> undefined. */
function optionalText(label: string, max: number) {
  return z.preprocess(
    toOptionalString,
    z
      .string({ error: `${label} must be text.` })
      .max(max, `${label} is too long (max ${max} characters).`)
      .transform((v) => sanitizeFullName(v, max) || undefined)
      .optional(),
  )
}

/** Detection metadata forwarded by the client. Bounded so it can't be abused, then ignored. */
function optionalMeta(label: string) {
  return z.preprocess(
    toOptionalString,
    z.string({ error: `${label} must be text.` }).max(REPORT_LIMITS.metaMax, `${label} is too long.`).optional(),
  )
}

const resolution = z
  .string({ error: 'Resolution is required.' })
  .trim()
  .regex(/^\d{3,5}x\d{3,5}$/, 'Pick a resolution like 1920x1080.')
  .refine((v) => {
    const [w, h] = v.split('x').map(Number)
    return (
      w >= REPORT_LIMITS.resolutionMinWidth &&
      w <= REPORT_LIMITS.resolutionMaxWidth &&
      h >= REPORT_LIMITS.resolutionMinHeight &&
      h <= REPORT_LIMITS.resolutionMaxHeight
    )
  }, 'Resolution is outside the supported range.')

/** Field definitions shared by every report schema. */
export const reportFieldShape = {
  cpu: hardwareName('CPU'),
  gpu: hardwareName('GPU'),
  ram: requiredNumber('RAM (GB)', REPORT_LIMITS.ramMinGb, REPORT_LIMITS.ramMaxGb, { int: true }),
  ramSpeed: optionalText('RAM speed', REPORT_LIMITS.ramSpeedMax),
  resolution,
  refreshRate: optionalNumber('Refresh rate (Hz)', REPORT_LIMITS.refreshMinHz, REPORT_LIMITS.refreshMaxHz, { int: true }),
  settingsPreset: z.enum(GRAPHICS_PRESETS, { error: 'Pick a graphics preset.' }),
  customSettingsNotes: optionalText('Custom settings notes', REPORT_LIMITS.customSettingsMax),
  avgFps: requiredNumber('Average FPS', REPORT_LIMITS.fpsMin, REPORT_LIMITS.fpsMax),
  fps1PercentLow: optionalNumber('1% low FPS', 0, REPORT_LIMITS.fpsMax, { exclusiveMin: true }),
  notes: optionalText('Notes', REPORT_LIMITS.notesMax),
  issues: optionalText('Issues', REPORT_LIMITS.issuesMax),
  tweaks: optionalText('Tweaks', REPORT_LIMITS.tweaksMax),
  driverVersion: optionalText('Driver version', REPORT_LIMITS.driverMax),
}

type CrossFieldInput = { avgFps: number; fps1PercentLow?: number; settingsPreset: GraphicsPreset; customSettingsNotes?: string }

/** Rules that span fields; applied to every report schema. */
function crossFieldRules<T extends CrossFieldInput>(value: T, ctx: z.RefinementCtx): void {
  if (value.fps1PercentLow != null && value.fps1PercentLow > value.avgFps) {
    ctx.addIssue({
      code: 'custom',
      path: ['fps1PercentLow'],
      message: '1% low FPS cannot be higher than average FPS.',
    })
  }
}

/** Custom-settings notes only make sense for the Custom preset. */
function dropCustomNotesUnlessCustom<T extends CrossFieldInput>(value: T): T {
  return value.settingsPreset === 'Custom' ? value : { ...value, customSettingsNotes: undefined }
}

const submitOnlyShape = {
  kernel: optionalMeta('Kernel'),
  distro: optionalMeta('Distro'),
  canonicalCpu: optionalMeta('Canonical CPU'),
  canonicalGpu: optionalMeta('Canonical GPU'),
}

/** Client form (submit dialog). Game id is any non-empty string because mock mode uses slugs. */
export const reportFormSchema = z
  .object({ gameId: z.string().min(1, 'Pick a game.'), ...reportFieldShape })
  .superRefine(crossFieldRules)

/** Client form (edit dialog). */
export const reportEditFormSchema = z.object(reportFieldShape).superRefine(crossFieldRules)

/** Server: new report. Strict (unknown keys rejected) and the game id must be a UUID. */
export const submitReportInputSchema = z
  .strictObject({
    gameId: z.uuid({ error: 'Game not found. Cannot submit report.' }),
    ...reportFieldShape,
    ...submitOnlyShape,
  })
  .superRefine(crossFieldRules)
  .transform(dropCustomNotesUnlessCustom)

/** Server: edit of an existing report. Strict; identity fields (game, user, status) are not editable. */
export const updateReportInputSchema = z
  .strictObject(reportFieldShape)
  .superRefine(crossFieldRules)
  .transform(dropCustomNotesUnlessCustom)

export const reportIdSchema = z.uuid({ error: 'Missing report id.' })

export type ReportFormValues = z.input<typeof reportFormSchema>
export type ReportEditFormValues = z.input<typeof reportEditFormSchema>
export type SubmitReportFields = z.output<typeof submitReportInputSchema>
export type UpdateReportFields = z.output<typeof updateReportInputSchema>

/** First issue as a single user-facing sentence (toasts have room for one line). */
export function formatReportInputError(error: z.ZodError): string {
  const unknownKeys = error.issues.find((i) => i.code === 'unrecognized_keys')
  if (unknownKeys) return 'The report contained fields that cannot be set. Please reload the page and try again.'
  const first = error.issues[0]
  return first?.message || 'Please check the report fields and try again.'
}

/** Authoritative tier calculation (the dialogs show a non-authoritative preview). */
export function calculatePerformanceTier(avgFps: number): PerformanceTier {
  if (avgFps >= 90) return 'Excellent'
  if (avgFps >= 60) return 'Good'
  if (avgFps >= 40) return 'Playable'
  if (avgFps >= 25) return 'Struggling'
  return 'Unplayable'
}

// ---------------------------------------------------------------------------
// Auto-review (plausibility) rule
// ---------------------------------------------------------------------------

const LINK_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|gg|ru|xyz|ly|me|co|link|site|shop|top|info|biz)\b)/i

/** True when raw (pre-sanitize) text looks like it carries a link. Sanitizing strips the protocol, so check the raw value. */
export function containsLink(raw: unknown): boolean {
  return typeof raw === 'string' && LINK_PATTERN.test(raw)
}

const RAW_TEXT_KEYS = ['cpu', 'gpu', 'ramSpeed', 'customSettingsNotes', 'notes', 'issues', 'tweaks', 'driverVersion'] as const

/**
 * Reasons a report should wait for a moderator instead of publishing immediately.
 * Empty array = plausible, publish. Kept deliberately narrow so normal reports stay instant.
 *
 * @param fields validated fields
 * @param raw the raw payload (before sanitizing), used only for link detection
 */
export function assessReportPlausibility(
  fields: Pick<SubmitReportFields, 'cpu' | 'gpu' | 'avgFps'>,
  raw: unknown,
): string[] {
  const reasons: string[] = []
  if (normalizeHardwareSync(fields.cpu).method === 'none') reasons.push('CPU not in hardware catalog')
  if (normalizeHardwareSync(fields.gpu).method === 'none') reasons.push('GPU not in hardware catalog')
  if (fields.avgFps > AUTO_REVIEW_FPS_THRESHOLD) reasons.push(`average FPS above ${AUTO_REVIEW_FPS_THRESHOLD}`)
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    if (RAW_TEXT_KEYS.some((k) => containsLink(record[k]))) reasons.push('link in text fields')
  }
  return reasons
}

/** Moderator note recorded when a report is held for review. */
export function autoReviewNote(reasons: string[]): string {
  return `[Auto-review: ${reasons.join('; ')}]`
}
