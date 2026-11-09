/**
 * The moderation RPCs are EXECUTE-able by service_role only
 * (supabase/migrations/20261109000600_moderation_rpcs_service_role_only.sql).
 * Guard the assumption that makes that safe: only lib/server/admin-moderation.ts calls
 * them, and only server actions import that module.
 *
 * Run: npx tsx --test tests/moderation-rpc-callers.test.ts
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const RPCS = ['moderate_reports', 'delete_reports', 'moderate_report_images', 'delete_report_images']

function sources(): string[] {
  return ['app', 'components', 'lib', 'scripts']
    .flatMap((root) => readdirSync(root, { recursive: true }).map(String).map((f) => join(root, f)))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'))
}

test('moderation RPCs are only called from lib/server/admin-moderation.ts', () => {
  const callers = sources().filter((f) => {
    const src = readFileSync(f, 'utf8')
    return RPCS.some((fn) => src.includes(`rpc('${fn}'`) || src.includes(`rpc("${fn}"`))
  })
  assert.deepEqual(callers, ['lib/server/admin-moderation.ts'])
})

test('admin-moderation is only imported by server actions, which pass the service client', () => {
  const importers = sources().filter((f) => /lib\/server\/admin-moderation'/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(importers.sort(), ['app/actions/admin.ts', 'app/actions/reports.ts'])
  for (const f of importers) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /^'use server'/, f)
    assert.match(src, /createServiceClient\(\)/, f)
  }
})
