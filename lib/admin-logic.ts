/**
 * Pure helpers shared by the real (Supabase) and mock admin moderation paths.
 * No fetches, no localStorage, no Supabase — everything here is unit-testable.
 */

import type { HardwareAlias, ReportImage, ReportStatus } from './types'
import { normalizeSlug } from './utils'

export const REPORT_STATUSES: readonly ReportStatus[] = ['pending', 'approved', 'rejected', 'flagged']

export type ImageStatus = 'pending' | 'approved' | 'rejected'
export const IMAGE_STATUSES: readonly ImageStatus[] = ['pending', 'approved', 'rejected']

/** Maximum ids accepted by one bulk RPC call (mirrors the SQL guard). */
export const MAX_BULK_IDS = 200

export interface AdminOverviewStats {
  totalReports: number
  pendingReports: number
  totalGames: number
  pendingImages: number
  hardwareAliases: number
  importedGames: number
}

export const EMPTY_ADMIN_STATS: AdminOverviewStats = {
  totalReports: 0,
  pendingReports: 0,
  totalGames: 0,
  pendingImages: 0,
  hardwareAliases: 0,
  importedGames: 0,
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value)
}

export function isImageStatus(value: unknown): value is ImageStatus {
  return typeof value === 'string' && (IMAGE_STATUSES as readonly string[]).includes(value)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/**
 * Validate a list of ids for a bulk action: de-duplicates, rejects non-UUIDs and
 * enforces the per-call cap. Throws with a user-friendly message.
 */
export function normalizeBulkIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) throw new Error('Expected a list of ids.')
  const unique = Array.from(new Set(ids.map((v) => String(v ?? '').trim()).filter(Boolean)))
  if (unique.length === 0) throw new Error('Select at least one item.')
  if (unique.length > MAX_BULK_IDS) {
    throw new Error(`At most ${MAX_BULK_IDS} items can be processed per action.`)
  }
  const invalid = unique.find((id) => !isUuid(id))
  if (invalid) throw new Error('One or more ids are not valid.')
  return unique
}

/** Trim moderator notes to a nullable string with a defensive length cap. */
export function cleanModeratorNotes(notes: unknown, max = 1000): string | null {
  if (notes == null) return null
  const t = String(notes).trim()
  return t ? t.slice(0, max) : null
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB -> domain types)
// ---------------------------------------------------------------------------

export interface DbHardwareAliasRow {
  id: string
  raw_string: string
  canonical: string
  vendor?: string | null
  series?: string | null
  created_at: string
}

export function mapDbHardwareAlias(row: DbHardwareAliasRow): HardwareAlias {
  return {
    id: row.id,
    rawString: row.raw_string,
    canonical: row.canonical,
    vendor: row.vendor ?? undefined,
    series: row.series ?? undefined,
    createdAt: row.created_at,
  }
}

export interface DbReportImageRow {
  id: string
  report_id: string
  image_url: string
  caption?: string | null
  status?: string | null
  created_at: string
}

export function mapDbReportImage(row: DbReportImageRow): ReportImage {
  return {
    id: row.id,
    reportId: row.report_id,
    imageUrl: row.image_url,
    caption: row.caption ?? undefined,
    status: isImageStatus(row.status) ? row.status : 'pending',
    createdAt: row.created_at,
  }
}

// ---------------------------------------------------------------------------
// Hardware alias input validation
// ---------------------------------------------------------------------------

export interface HardwareAliasInput {
  rawString: string
  canonical: string
  vendor?: string | null
  series?: string | null
}

export interface CleanHardwareAliasInput {
  raw_string: string
  canonical: string
  vendor: string | null
  series: string | null
}

export function validateHardwareAliasInput(input: HardwareAliasInput): CleanHardwareAliasInput {
  const raw = String(input.rawString ?? '').trim()
  const canonical = String(input.canonical ?? '').trim()
  if (raw.length < 2 || raw.length > 120) {
    throw new Error('Raw string must be between 2 and 120 characters.')
  }
  if (canonical.length < 2 || canonical.length > 120) {
    throw new Error('Canonical name must be between 2 and 120 characters.')
  }
  const vendor = String(input.vendor ?? '').trim().slice(0, 60)
  const series = String(input.series ?? '').trim().slice(0, 60)
  return {
    raw_string: raw,
    canonical,
    vendor: vendor || null,
    series: series || null,
  }
}

/** Case-insensitive alias search across raw, canonical and vendor (shared with mock path). */
export function filterHardwareAliases(aliases: HardwareAlias[], search?: string): HardwareAlias[] {
  const q = search?.trim().toLowerCase()
  const list = q
    ? aliases.filter(
        (a) =>
          a.rawString.toLowerCase().includes(q) ||
          a.canonical.toLowerCase().includes(q) ||
          (a.vendor ?? '').toLowerCase().includes(q)
      )
    : aliases.slice()
  return list.sort((a, b) => a.rawString.localeCompare(b.rawString))
}

// ---------------------------------------------------------------------------
// Bulk game import row parsing (CSV / JSON)
// ---------------------------------------------------------------------------

export interface BulkGameRowInput {
  name: string
  slug: string
  coverUrl: string | null
  attribution: string | null
  genres: string[]
  releaseYear: number | null
  developer: string | null
  publisher: string | null
  steamAppId: string | null
  igdbId: string | null
}

export type BulkGameRowResult =
  | { ok: true; row: number; game: BulkGameRowInput }
  | { ok: false; row: number; message: string }

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k]
  }
  return undefined
}

function toGenres(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((g) => String(g).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value.split(/[,;|]/).map((g) => g.trim()).filter(Boolean)
  }
  return []
}

function toYear(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1970 || n > 2100) return null
  return n
}

function toIdString(value: unknown): string | null {
  if (value == null || value === '') return null
  const s = String(value).trim()
  return /^\d+$/.test(s) ? s : null
}

/**
 * Normalize loosely-shaped CSV/JSON rows (name/Name, slug/Slug, cover/cover_url/coverImage,
 * genres as array or delimited string...) into DB-ready game inputs. Rows are numbered
 * from 2 (row 1 is the CSV header) to match what the user sees in their spreadsheet.
 */
export function parseBulkGameRows(rows: unknown[]): BulkGameRowResult[] {
  const seen = new Set<string>()
  return rows.map((raw, index) => {
    const rowNum = index + 2
    if (!raw || typeof raw !== 'object') {
      return { ok: false, row: rowNum, message: 'Row is not an object' }
    }
    const row = raw as Record<string, unknown>
    const name = String(pick(row, ['name', 'Name', 'title', 'Title']) ?? '').trim()
    if (!name) return { ok: false, row: rowNum, message: 'Missing name' }
    if (name.length > 200) return { ok: false, row: rowNum, message: 'Name is too long (max 200)' }

    const slug = normalizeSlug(String(pick(row, ['slug', 'Slug']) ?? name))
    if (!slug) return { ok: false, row: rowNum, message: 'Could not derive a slug' }
    if (seen.has(slug)) return { ok: false, row: rowNum, message: `Duplicate slug in import: ${slug}` }
    seen.add(slug)

    const cover = pick(row, ['coverImage', 'cover_url', 'coverUrl', 'cover'])
    const coverUrl = typeof cover === 'string' && /^https?:\/\//i.test(cover.trim()) ? cover.trim() : null

    return {
      ok: true,
      row: rowNum,
      game: {
        name,
        slug,
        coverUrl,
        attribution: (pick(row, ['coverAttribution', 'cover_attribution', 'attribution']) as string | undefined)?.toString().trim() || null,
        genres: toGenres(pick(row, ['genres', 'Genres', 'genre'])),
        releaseYear: toYear(pick(row, ['releaseYear', 'release_year', 'year', 'Year'])),
        developer: (pick(row, ['developer', 'Developer']) as string | undefined)?.toString().trim() || null,
        publisher: (pick(row, ['publisher', 'Publisher']) as string | undefined)?.toString().trim() || null,
        steamAppId: toIdString(pick(row, ['steamAppId', 'steam_app_id'])),
        igdbId: toIdString(pick(row, ['igdbId', 'igdb_id'])),
      },
    }
  })
}
