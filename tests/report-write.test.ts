/**
 * Server-side report write tests (lib/server/report-write.ts) with in-memory fakes.
 * These call the same core the server actions use, with payloads a browser form would
 * never send, to prove the server does not trust the client.
 *
 * Run: npx tsx --test tests/report-write.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  REPORTS_PER_HOUR,
  REPORT_EDITS_PER_HOUR,
  submitReport,
  updateReport,
  type OwnReport,
  type ReportInsertRow,
  type ReportUpdateRow,
  type ReportWriteDeps,
  type ReportWriter,
} from '../lib/server/report-write'

const USER: ReportWriter = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'u@example.com', is_anonymous: false }
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const GAME = { id: '0b6a5b8e-5d2c-4c1e-9a3f-2d7f1e0c9a11', name: 'Cyberpunk 2077' }
const REPORT_ID = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-11-09T12:00:00Z')

type Fake = ReportWriteDeps<{ id: string } & Record<string, unknown>> & {
  inserts: ReportInsertRow[]
  updates: { id: string; userId: string; row: ReportUpdateRow }[]
  edits: { reportId: string; userId: string }[]
  lastSince?: string
  lastEditSince?: string
}

function fake(opts: {
  user?: ReportWriter | null
  staff?: boolean
  recent?: number
  dups?: number
  report?: OwnReport | null
  failWrite?: boolean
  editsLastHour?: number
  failEditLog?: boolean
} = {}): Fake {
  const f: Fake = {
    inserts: [],
    updates: [],
    edits: [],
    getUser: async () => (opts.user === undefined ? USER : opts.user),
    isStaff: async () => opts.staff ?? false,
    findGame: async (id) => (id === GAME.id ? GAME : null),
    countReportsSince: async (_u, since) => {
      f.lastSince = since
      return opts.recent ?? 0
    },
    countDuplicates: async () => opts.dups ?? 0,
    insertReport: async (row) => {
      f.inserts.push(row)
      return opts.failWrite ? null : { id: 'new', ...row }
    },
    findReport: async (id) => (opts.report === undefined ? { id, user_id: USER.id, status: 'approved', moderator_notes: null } : opts.report),
    updateOwnReport: async (id, userId, row) => {
      f.updates.push({ id, userId, row })
      return opts.failWrite ? null : { id, ...row }
    },
    countEditsSince: async (_u, since) => {
      f.lastEditSince = since
      return opts.editsLastHour ?? 0
    },
    recordEdit: async (reportId, userId) => {
      if (opts.failEditLog) throw new Error('log down')
      f.edits.push({ reportId, userId })
    },
    now: () => NOW,
  }
  return f
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gameId: GAME.id,
    cpu: 'AMD Ryzen 7 7800X3D',
    gpu: 'NVIDIA GeForce RTX 4070',
    ram: 32,
    resolution: '2560x1440',
    settingsPreset: 'High',
    avgFps: 95,
    fps1PercentLow: 70,
    ...overrides,
  }
}

function editPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { gameId: _g, ...rest } = payload(overrides)
  return rest
}

// ---------------------------------------------------------------- submit

test('submit: plausible report from a registered user publishes with server-computed tier', async () => {
  const f = fake()
  const r = await submitReport(f, payload())
  assert.equal(r.ok, true)
  assert.equal(f.inserts.length, 1)
  const row = f.inserts[0]
  assert.equal(row.status, 'approved')
  assert.equal(row.moderator_notes, null)
  assert.equal(row.user_id, USER.id)
  assert.equal(row.game_name, 'Cyberpunk 2077')
  assert.equal(row.performance_tier, 'Excellent')
  assert.equal(f.lastSince, new Date(NOW - 3600_000).toISOString())
})

test('submit: guests and anonymous sessions are rejected before any write', async () => {
  for (const user of [null, { ...USER, is_anonymous: true }, { ...USER, email: null }]) {
    const f = fake({ user })
    const r = await submitReport(f, payload())
    assert.deepEqual(r, { ok: false, error: 'You must sign in to submit a report.' })
    assert.equal(f.inserts.length, 0)
  }
})

test('submit: tampered payloads (bypassing the form) are rejected and nothing is written', async () => {
  const cases: [Record<string, unknown> | unknown, RegExp][] = [
    [payload({ status: 'approved' }), /fields that cannot be set/],
    [payload({ user_id: OTHER }), /fields that cannot be set/],
    [payload({ helpful_votes: 1000 }), /fields that cannot be set/],
    [payload({ performance_tier: 'Excellent', avgFps: 5 }), /fields that cannot be set/],
    [payload({ avgFps: 1e9 }), /at most 600/],
    [payload({ avgFps: -5 }), /at least 1/],
    [payload({ avgFps: 'NaN' }), /must be a number/],
    [payload({ ram: 100000 }), /RAM/],
    [payload({ settingsPreset: 'Insane' }), /graphics preset/],
    [payload({ resolution: '1; drop table reports' }), /like 1920x1080/],
    [payload({ notes: 'x'.repeat(5000) }), /too long/],
    [payload({ fps1PercentLow: 500 }), /cannot be higher than average/],
    [payload({ gameId: 'not-a-uuid' }), /Game not found/],
    [payload({ gameId: undefined }), /Game not found/],
    ['just a string', /./],
    [null, /./],
    [[payload()], /./],
  ]
  for (const [input, msg] of cases) {
    const f = fake()
    const r = await submitReport(f, input)
    assert.equal(r.ok, false, JSON.stringify(input)?.slice(0, 80))
    if (!r.ok) assert.match(r.error, msg)
    assert.equal(f.inserts.length, 0)
  }
})

test('submit: unknown game id (valid UUID) is rejected', async () => {
  const f = fake()
  const r = await submitReport(f, payload({ gameId: '99999999-9999-4999-8999-999999999999' }))
  assert.deepEqual(r, { ok: false, error: 'Game not found. Cannot submit report.' })
  assert.equal(f.inserts.length, 0)
})

test('submit: rate limit at REPORTS_PER_HOUR and 24h duplicate check', async () => {
  const under = fake({ recent: REPORTS_PER_HOUR - 1 })
  assert.equal((await submitReport(under, payload())).ok, true)

  const over = fake({ recent: REPORTS_PER_HOUR })
  const r = await submitReport(over, payload())
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /Rate limit reached/)
  assert.equal(over.inserts.length, 0)

  const dup = fake({ dups: 1 })
  const d = await submitReport(dup, payload())
  assert.equal(d.ok, false)
  if (!d.ok) assert.match(d.error, /Duplicate report/)
  assert.equal(dup.inserts.length, 0)
})

test('submit: implausible reports are held as pending with a moderator note', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ cpu: 'Zzqx Quantum 9000' }, 'CPU not in hardware catalog'],
    [{ avgFps: 450, fps1PercentLow: 300 }, 'average FPS above 360'],
    [{ notes: 'cheap keys at https://spam.example' }, 'link in text fields'],
    [{ tweaks: 'join discord.gg/abc' }, 'link in text fields'],
  ]
  for (const [over, reason] of cases) {
    const f = fake()
    const r = await submitReport(f, payload(over))
    assert.equal(r.ok, true)
    assert.equal(f.inserts[0].status, 'pending', reason)
    assert.match(f.inserts[0].moderator_notes ?? '', new RegExp(`^\\[Auto-review: .*${reason}`))
  }
})

test('submit: moderators/admins publish implausible reports directly (note kept for context)', async () => {
  const f = fake({ staff: true })
  await submitReport(f, payload({ avgFps: 500, fps1PercentLow: 400 }))
  assert.equal(f.inserts[0].status, 'approved')
  assert.match(f.inserts[0].moderator_notes ?? '', /Auto-review/)
})

test('submit: a failed insert returns a generic error (no DB details leak)', async () => {
  const r = await submitReport(fake({ failWrite: true }), payload())
  assert.deepEqual(r, { ok: false, error: 'Failed to submit report. Please try again.' })
})

// ---------------------------------------------------------------- update

test('update: owner edit of an approved report keeps it approved and recomputes the tier', async () => {
  const f = fake()
  const r = await updateReport(f, REPORT_ID, editPayload({ avgFps: 45, fps1PercentLow: 30 }))
  assert.equal(r.ok, true)
  assert.equal(f.updates.length, 1)
  assert.equal(f.updates[0].userId, USER.id)
  assert.equal(f.updates[0].row.performance_tier, 'Playable')
  assert.equal('status' in f.updates[0].row, false)
})

test('update: requires sign-in, a UUID id and ownership (same message for missing and foreign)', async () => {
  assert.deepEqual(await updateReport(fake({ user: null }), REPORT_ID, editPayload()), {
    ok: false,
    error: 'You must sign in to edit a report.',
  })
  assert.deepEqual(await updateReport(fake(), 'abc', editPayload()), { ok: false, error: 'Missing report id.' })
  for (const report of [null, { id: REPORT_ID, user_id: OTHER, status: 'approved' as const, moderator_notes: null }]) {
    const f = fake({ report })
    assert.deepEqual(await updateReport(f, REPORT_ID, editPayload()), { ok: false, error: 'You can only edit your own reports.' })
    assert.equal(f.updates.length, 0)
  }
})

test('update: tampered payloads cannot change identity, status or counters', async () => {
  for (const extra of [{ status: 'approved' }, { gameId: GAME.id }, { user_id: OTHER }, { vote_score: 99 }, { moderatorNotes: '' }]) {
    const f = fake({ report: { id: REPORT_ID, user_id: USER.id, status: 'pending', moderator_notes: null } })
    const r = await updateReport(f, REPORT_ID, { ...editPayload(), ...extra })
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, /fields that cannot be set/)
    assert.equal(f.updates.length, 0)
  }
  const f = fake()
  const r = await updateReport(f, REPORT_ID, editPayload({ avgFps: 9999 }))
  assert.equal(r.ok, false)
  assert.equal(f.updates.length, 0)
})

test('update: an approved report edited into an implausible one goes back to review', async () => {
  const f = fake({ report: { id: REPORT_ID, user_id: USER.id, status: 'approved', moderator_notes: 'old note' } })
  await updateReport(f, REPORT_ID, editPayload({ avgFps: 599, fps1PercentLow: 400 }))
  assert.equal(f.updates[0].row.status, 'pending')
  assert.equal(f.updates[0].row.moderator_notes, 'old note\n[Auto-review: average FPS above 360]')
})

test('update: edits never promote pending/rejected reports', async () => {
  for (const status of ['pending', 'rejected', 'flagged'] as const) {
    const f = fake({ report: { id: REPORT_ID, user_id: USER.id, status, moderator_notes: null } })
    await updateReport(f, REPORT_ID, editPayload())
    assert.equal(f.updates[0].row.status, undefined, status)
  }
})

test('update: staff keep their own approved report live after an outlier edit', async () => {
  const f = fake({ staff: true })
  await updateReport(f, REPORT_ID, editPayload({ avgFps: 599, fps1PercentLow: 400 }))
  assert.equal(f.updates[0].row.status, undefined)
})

test('update: edit rate limit per user per hour, counted before writing', async () => {
  const under = fake({ editsLastHour: REPORT_EDITS_PER_HOUR - 1 })
  assert.equal((await updateReport(under, REPORT_ID, editPayload())).ok, true)
  assert.deepEqual(under.edits, [{ reportId: REPORT_ID, userId: USER.id }])
  assert.equal(under.lastEditSince, new Date(NOW - 3600_000).toISOString())

  const over = fake({ editsLastHour: REPORT_EDITS_PER_HOUR })
  const r = await updateReport(over, REPORT_ID, editPayload())
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /Edit limit reached/)
  assert.equal(over.updates.length, 0)
  assert.equal(over.edits.length, 0)
})

test('update: failed edits are not logged; a failing log write does not undo a saved edit', async () => {
  const failed = fake({ failWrite: true })
  assert.equal((await updateReport(failed, REPORT_ID, editPayload())).ok, false)
  assert.equal(failed.edits.length, 0)

  const orig = console.error
  console.error = () => {}
  try {
    const logDown = fake({ failEditLog: true })
    assert.equal((await updateReport(logDown, REPORT_ID, editPayload())).ok, true)
    assert.equal(logDown.updates.length, 1)
  } finally {
    console.error = orig
  }
})
