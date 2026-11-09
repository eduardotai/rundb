/**
 * lib/server/report-vote.ts with a stub client: auth, input checks, payload shape and
 * the mapping of DB errors to friendly messages.
 *
 * Run: npx tsx --test tests/report-vote.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

import { castReportVote } from '../lib/server/report-vote'

const USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'u@example.com', is_anonymous: false }
const REPORT = '11111111-1111-4111-8111-111111111111'

function stub(error: { code?: string; message: string } | null = null) {
  const calls: { op: string; args: unknown[] }[] = []
  const builder: Record<string, unknown> = {}
  const result = Promise.resolve({ data: null, error })
  for (const op of ['delete', 'eq']) {
    builder[op] = (...args: unknown[]) => {
      calls.push({ op, args })
      return Object.assign(Object.create(result), builder, { then: result.then.bind(result) })
    }
  }
  builder.upsert = (...args: unknown[]) => {
    calls.push({ op: 'upsert', args })
    return result
  }
  const client = { from: (t: string) => (calls.push({ op: 'from', args: [t] }), builder) } as unknown as SupabaseClient
  return { client, calls }
}

test('upvote upserts one row for the caller', async () => {
  const s = stub()
  assert.deepEqual(await castReportVote(s.client, USER, REPORT, 1), { ok: true, data: null })
  const up = s.calls.find((c) => c.op === 'upsert')!
  assert.deepEqual(up.args, [{ report_id: REPORT, user_id: USER.id, vote: 1 }, { onConflict: 'report_id,user_id' }])
})

test('vote 0 deletes only the caller\'s vote', async () => {
  const s = stub()
  assert.equal((await castReportVote(s.client, USER, REPORT, 0)).ok, true)
  assert.deepEqual(
    s.calls.filter((c) => c.op === 'eq').map((c) => c.args),
    [['report_id', REPORT], ['user_id', USER.id]],
  )
})

test('rejects guests, bad ids and bad values before touching the DB', async () => {
  const cases: [Parameters<typeof castReportVote>[1], unknown, unknown, string][] = [
    [null, REPORT, 1, 'You must sign in to vote on reports.'],
    [{ ...USER, is_anonymous: true }, REPORT, 1, 'You must sign in to vote on reports.'],
    [USER, 'abc', 1, 'Report not found.'],
    [USER, REPORT, 2, 'Invalid vote.'],
    [USER, REPORT, '1', 'Invalid vote.'],
  ]
  for (const [user, id, value, msg] of cases) {
    const s = stub()
    assert.deepEqual(await castReportVote(s.client, user, id, value), { ok: false, error: msg })
    assert.equal(s.calls.length, 0)
  }
})

test('maps DB errors to friendly messages without leaking details', async () => {
  const orig = console.error
  console.error = () => {}
  try {
    assert.deepEqual(await castReportVote(stub({ code: '42501', message: 'new row violates row-level security policy' }).client, USER, REPORT, 1), {
      ok: false,
      error: "You can't vote on your own report.",
    })
    assert.deepEqual(await castReportVote(stub({ code: '23503', message: 'fk' }).client, USER, REPORT, -1), {
      ok: false,
      error: 'Report not found.',
    })
    assert.deepEqual(await castReportVote(stub({ code: 'XX000', message: 'internal detail' }).client, USER, REPORT, 1), {
      ok: false,
      error: 'Failed to register vote. Please try again.',
    })
  } finally {
    console.error = orig
  }
})
