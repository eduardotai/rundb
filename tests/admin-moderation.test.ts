/**
 * Driver tests for lib/server/admin-moderation.ts using an in-memory Supabase stub.
 * Exercises the real functions (RPC payloads, dedup, audit logging) without a database.
 *
 * Run: npx tsx --test tests/admin-moderation.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  bulkImportGames,
  createHardwareAlias,
  deleteHardwareAlias,
  deleteReportImages,
  getAdminOverviewStats,
  listHardwareAliases,
  listReportImages,
  moderateReportImages,
  moderateReports,
} from '../lib/server/admin-moderation'

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'

type RpcCall = { fn: string; args: Record<string, unknown> }

/**
 * Minimal chainable stub. Records rpc() calls and .from() operations; returns
 * canned data per table. Only the builder methods used by the module exist.
 */
function makeStubClient(opts: {
  rpcResult?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string; code?: string } | null }
  tables?: Record<string, unknown[]>
  counts?: Record<string, number>
  insertError?: { message: string; code?: string }
} = {}) {
  const rpcCalls: RpcCall[] = []
  const inserts: Array<{ table: string; rows: unknown[] }> = []
  const filters: Array<{ table: string; op: string; args: unknown[] }> = []
  const tables = opts.tables ?? {}

  function builder(table: string) {
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let head = false
    let pendingRows: unknown[] = []
    const result = () => {
      if (head) {
        return { data: null, count: opts.counts?.[table] ?? 0, error: null }
      }
      if (mode === 'insert') {
        if (opts.insertError && table !== 'moderation_log') {
          return { data: null, error: opts.insertError }
        }
        const rows = pendingRows.map((r, i) => ({ id: `${table}-${i + 1}`.padEnd(36, '0'), created_at: 'now', ...(r as object) }))
        return { data: rows, error: null }
      }
      if (mode === 'delete') return { data: tables[table] ?? [], error: null }
      return { data: tables[table] ?? [], error: null }
    }
    const b: any = {
      select(_cols?: string, o?: { head?: boolean }) {
        if (o?.head) head = true
        return b
      },
      insert(rows: unknown) {
        mode = 'insert'
        pendingRows = Array.isArray(rows) ? rows : [rows]
        inserts.push({ table, rows: pendingRows })
        return b
      },
      update() { mode = 'update'; return b },
      delete() { mode = 'delete'; return b },
      eq(...args: unknown[]) { filters.push({ table, op: 'eq', args }); return b },
      in(...args: unknown[]) { filters.push({ table, op: 'in', args }); return b },
      or(...args: unknown[]) { filters.push({ table, op: 'or', args }); return b },
      order() { return b },
      limit() { return b },
      async single() {
        const r = result()
        return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }
      },
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        return Promise.resolve(result()).then(resolve, reject)
      },
    }
    return b
  }

  const client = {
    from: (table: string) => builder(table),
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      if (opts.rpcResult) return opts.rpcResult(fn, args)
      const ids = args.p_report_ids ?? args.p_image_ids
      return { data: Array.isArray(ids) ? ids.length : 0, error: null }
    },
  } as unknown as SupabaseClient

  return { client, rpcCalls, inserts, filters }
}

test('moderateReports calls the audited RPC with de-duplicated ids and the verified actor', async () => {
  const { client, rpcCalls } = makeStubClient()
  const updated = await moderateReports(client, ACTOR, [R1, R1, R2], 'approved', '  looks legit ')
  assert.equal(updated, 2)
  assert.equal(rpcCalls.length, 1)
  assert.equal(rpcCalls[0].fn, 'moderate_reports')
  assert.deepEqual(rpcCalls[0].args, {
    p_report_ids: [R1, R2],
    p_status: 'approved',
    p_notes: 'looks legit',
    p_actor: ACTOR,
  })
})

test('moderateReports keeps notes when omitted and clears them when passed empty', async () => {
  const { client, rpcCalls } = makeStubClient()
  await moderateReports(client, ACTOR, [R1], 'rejected')
  await moderateReports(client, ACTOR, [R1], 'rejected', '')
  assert.equal(rpcCalls[0].args.p_notes, null, 'undefined notes -> NULL (RPC keeps existing notes)')
  assert.equal(rpcCalls[1].args.p_notes, '', 'empty string -> RPC clears notes')
})

test('moderateReports rejects invalid statuses and ids before touching the database', async () => {
  const { client, rpcCalls } = makeStubClient()
  await assert.rejects(() => moderateReports(client, ACTOR, [R1], 'deleted' as never), /Invalid report status/)
  await assert.rejects(() => moderateReports(client, ACTOR, ['nope'], 'approved'), /not valid/)
  await assert.rejects(() => moderateReports(client, ACTOR, [], 'approved'), /at least one/)
  assert.equal(rpcCalls.length, 0)
})

test('RPC errors surface as friendly errors', async () => {
  const { client } = makeStubClient({
    rpcResult: () => ({ data: null, error: { message: 'moderator or admin role required', code: '42501' } }),
  })
  await assert.rejects(() => moderateReports(client, ACTOR, [R1], 'approved'), /moderator or admin role required/)
})

test('image moderation and deletion use their RPCs with validated payloads', async () => {
  const { client, rpcCalls } = makeStubClient()
  assert.equal(await moderateReportImages(client, ACTOR, [R1, R2], 'approved'), 2)
  assert.equal(await deleteReportImages(client, ACTOR, [R2]), 1)
  assert.deepEqual(rpcCalls.map((c) => c.fn), ['moderate_report_images', 'delete_report_images'])
  assert.deepEqual(rpcCalls[0].args, { p_image_ids: [R1, R2], p_status: 'approved', p_actor: ACTOR })
  assert.deepEqual(rpcCalls[1].args, { p_image_ids: [R2], p_actor: ACTOR })
  await assert.rejects(() => moderateReportImages(client, ACTOR, [R1], 'flagged' as never), /Invalid image status/)
})

test('listReportImages maps rows and applies the status filter', async () => {
  const { client, filters } = makeStubClient({
    tables: {
      report_images: [
        { id: R1, report_id: R2, image_url: 'https://x/1.webp', caption: 'proof', status: 'pending', created_at: 't' },
      ],
    },
  })
  const all = await listReportImages(client, 'all')
  assert.equal(all.length, 1)
  assert.equal(all[0].reportId, R2)
  assert.equal(filters.length, 0, '"all" adds no status filter')

  await listReportImages(client, 'rejected')
  assert.deepEqual(filters[0], { table: 'report_images', op: 'eq', args: ['status', 'rejected'] })
  await assert.rejects(() => listReportImages(client, 'bogus' as never), /Invalid image status/)
})

test('hardware alias create validates, inserts and writes an audit row; delete logs only when a row was removed', async () => {
  const { client, inserts, filters } = makeStubClient({ tables: { hardware_aliases: [{ id: R1 }] } })
  const created = await createHardwareAlias(client, ACTOR, {
    rawString: ' rtx 4090 ',
    canonical: 'NVIDIA GeForce RTX 4090',
    vendor: 'NVIDIA',
    series: '',
  })
  assert.equal(created.rawString, 'rtx 4090')
  assert.equal(inserts[0].table, 'hardware_aliases')
  assert.deepEqual(inserts[0].rows[0], {
    raw_string: 'rtx 4090',
    canonical: 'NVIDIA GeForce RTX 4090',
    vendor: 'NVIDIA',
    series: null,
  })
  assert.equal(inserts[1].table, 'moderation_log')
  const log = inserts[1].rows[0] as Record<string, unknown>
  assert.equal(log.actor_id, ACTOR)
  assert.equal(log.target_type, 'hardware_alias')
  assert.equal(log.action, 'create')

  assert.equal(await deleteHardwareAlias(client, ACTOR, R1), true)
  assert.deepEqual(filters.at(-1), { table: 'hardware_aliases', op: 'eq', args: ['id', R1] })
  assert.equal(inserts.at(-1)?.table, 'moderation_log')
  assert.equal((inserts.at(-1)?.rows[0] as Record<string, unknown>).action, 'delete')

  await assert.rejects(() => deleteHardwareAlias(client, ACTOR, 'not-a-uuid'), /not valid/)
})

test('duplicate alias raw strings produce a friendly conflict error', async () => {
  const { client } = makeStubClient({ insertError: { message: 'duplicate key value violates unique constraint', code: '23505' } })
  await assert.rejects(
    () => createHardwareAlias(client, ACTOR, { rawString: 'rtx 4090', canonical: 'NVIDIA GeForce RTX 4090' }),
    /already exists/
  )
})

test('listHardwareAliases escapes search input for the PostgREST or-filter', async () => {
  const { client, filters } = makeStubClient()
  await listHardwareAliases(client, 'rtx,40(90)%')
  assert.equal(filters.length, 1)
  const [expr] = filters[0].args as [string]
  assert.ok(expr.includes('raw_string.ilike.%rtx 40 90 \\%%'), expr)
  assert.ok(expr.includes('canonical.ilike.'))
  assert.ok(expr.includes('vendor.ilike.'))
})

test('bulkImportGames skips existing slugs, inserts skeleton rows and audits the import', async () => {
  const { client, inserts, filters } = makeStubClient({ tables: { games: [{ slug: 'elden-ring' }] } })
  const result = await bulkImportGames(client, ACTOR, [
    { name: 'Elden Ring' },
    { name: 'Hades II', developer: 'Supergiant', genres: 'Roguelike;Action', releaseYear: 2024 },
    { slug: 'nameless' },
  ])

  assert.equal(result.success, 1)
  assert.deepEqual(
    result.errors.map((e) => e.message).sort(),
    ['Duplicate slug: elden-ring', 'Missing name']
  )
  assert.equal(result.imported[0].slug, 'hades-ii')
  assert.equal(result.imported[0].ingestStatus, 'skeleton')

  assert.deepEqual(filters[0], { table: 'games', op: 'in', args: ['slug', ['elden-ring', 'hades-ii']] })
  const gameInsert = inserts.find((i) => i.table === 'games')
  assert.ok(gameInsert)
  assert.deepEqual(gameInsert!.rows[0], {
    slug: 'hades-ii',
    name: 'Hades II',
    cover_url: null,
    attribution: null,
    genres: ['Roguelike', 'Action'],
    release_year: 2024,
    developer: 'Supergiant',
    publisher: null,
    steam_app_id: null,
    igdb_id: null,
    ingest_status: 'skeleton',
  })
  const audit = inserts.find((i) => i.table === 'moderation_log')
  assert.ok(audit)
  assert.equal((audit!.rows[0] as Record<string, unknown>).action, 'bulk_import')
})

test('bulkImportGames refuses oversized batches without hitting the database', async () => {
  const { client, inserts } = makeStubClient()
  const result = await bulkImportGames(client, ACTOR, Array.from({ length: 501 }, (_, i) => ({ name: `G${i}` })))
  assert.equal(result.success, 0)
  assert.match(result.errors[0].message, /At most 500/)
  assert.equal(inserts.length, 0)
})

test('getAdminOverviewStats aggregates head-only counts', async () => {
  const { client } = makeStubClient({
    counts: { reports: 12, games: 40, report_images: 3, hardware_aliases: 7, moderation_log: 5 },
  })
  const stats = await getAdminOverviewStats(client)
  assert.equal(stats.totalReports, 12)
  assert.equal(stats.totalGames, 40)
  assert.equal(stats.hardwareAliases, 7)
  assert.equal(stats.importedGames, 5)
})

test('admin moderation SQL keeps privileged paths locked down', () => {
  const sql = readFileSync('supabase/incremental-admin-moderation.sql', 'utf8')

  for (const fn of ['moderate_reports', 'delete_reports', 'moderate_report_images', 'delete_report_images']) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), `${fn} must exist`)
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`), `${fn} must not be callable by anon`)
  }
  // Destructive RPCs require admin; moderation RPCs require moderator+.
  assert.match(sql, /delete_reports[\s\S]*?resolve_moderation_actor\(p_actor, true\)/)
  assert.match(sql, /delete_report_images[\s\S]*?resolve_moderation_actor\(p_actor, true\)/)
  assert.match(sql, /moderate_reports[\s\S]*?resolve_moderation_actor\(p_actor, false\)/)
  // p_actor is only trusted for service_role callers.
  assert.match(sql, /IF v_role = 'service_role' THEN[\s\S]*?RETURN p_actor;/)
  assert.match(sql, /RAISE EXCEPTION 'moderator or admin role required'/)
  // Public may only see approved images; pending/rejected never leak.
  assert.match(sql, /"Approved report images are publicly readable" ON public\.report_images\s+FOR SELECT USING \(status = 'approved'\)/)
  // Audit log is append-only from clients' perspective.
  assert.match(sql, /REVOKE ALL ON public\.moderation_log FROM anon, authenticated;/)
  assert.doesNotMatch(sql, /CREATE POLICY "[^"]*" ON public\.moderation_log\s+FOR (INSERT|UPDATE|DELETE|ALL)/)
  // Every SECURITY DEFINER function pins search_path.
  const code = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n')
  const definers = code.match(/SECURITY DEFINER\s+SET search_path = ''/g) ?? []
  const totalDefiners = code.match(/SECURITY DEFINER/g) ?? []
  assert.equal(definers.length, totalDefiners.length, 'all SECURITY DEFINER functions must pin search_path')
})
