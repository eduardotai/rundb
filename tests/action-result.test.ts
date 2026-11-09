/**
 * Server Actions return expected failures as values (lib/action-result.ts) because
 * production Next.js hides thrown messages. Covers the helper and statically checks
 * that the admin / vote / moderation actions use it.
 *
 * Run: npx tsx --test tests/action-result.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { UserFacingError, runAction, toActionFailure, unwrapAction } from '../lib/action-result'
import { normalizeBulkIds, validateHardwareAliasInput } from '../lib/admin-logic'

test('runAction: success wraps data', async () => {
  assert.deepEqual(await runAction('fallback', async () => 42), { ok: true, data: 42 })
})

test('runAction: user-facing errors pass through, anything else becomes the fallback', async () => {
  assert.deepEqual(
    await runAction('fallback', async () => {
      throw new UserFacingError('Access denied. Admin role required.')
    }),
    { ok: false, error: 'Access denied. Admin role required.' },
  )
  const origError = console.error
  console.error = () => {}
  try {
    assert.deepEqual(
      await runAction('Failed to delete reports.', async () => {
        throw new Error('duplicate key value violates unique constraint "secret_internal_idx"')
      }),
      { ok: false, error: 'Failed to delete reports.' },
    )
    assert.deepEqual(toActionFailure('weird', 'fb'), { ok: false, error: 'fb' })
  } finally {
    console.error = origError
  }
})

test('unwrapAction: returns data or throws an Error with the user-facing message', () => {
  assert.equal(unwrapAction({ ok: true, data: 'x' }), 'x')
  assert.throws(() => unwrapAction({ ok: false, error: "You can't vote on your own report." }), {
    message: "You can't vote on your own report.",
  })
  assert.throws(() => unwrapAction(undefined as never), /Unexpected response/)
})

test('admin input validation errors are user-facing', () => {
  for (const fn of [() => normalizeBulkIds([]), () => normalizeBulkIds(['nope']), () => validateHardwareAliasInput({ rawString: 'x', canonical: 'y' })]) {
    assert.throws(fn, (e: unknown) => e instanceof UserFacingError)
  }
})

function exportedSignatures(path: string): Map<string, string> {
  const src = readFileSync(path, 'utf8')
  const out = new Map<string, string>()
  const re = /export async function (\w+)\(([\s\S]*?)\):\s*(Promise<[\s\S]*?)\s*\{\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out.set(m[1], m[3])
  return out
}

test('every admin server action returns ActionResult', () => {
  const sigs = exportedSignatures('app/actions/admin.ts')
  assert.ok(sigs.size >= 11, `found ${sigs.size} actions`)
  for (const [name, ret] of sigs) assert.match(ret, /^Promise<ActionResult</, name)
  assert.doesNotMatch(readFileSync('app/actions/admin.ts', 'utf8'), /\bfriendly\(/)
})

test('report vote / moderation / ingestion actions return results', () => {
  const sigs = exportedSignatures('app/actions/reports.ts')
  for (const name of [
    'voteReportAction',
    'upvoteReportAction',
    'downvoteReportAction',
    'removeVoteReportAction',
    'moderateReportAction',
    'getModerationQueueAction',
    'triggerIngestionAction',
  ]) {
    assert.match(sigs.get(name) ?? '', /^Promise<ActionResult</, name)
  }
})
