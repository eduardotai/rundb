/**
 * Report free text keeps normal punctuation (lib/sanitize.ts sanitizeReportText), so XSS
 * safety relies on React escaping. Guard the assumption: user text must never reach
 * dangerouslySetInnerHTML, and the only allowed use renders repo markdown on the
 * internal dashboard (lib/server/dashboard.ts, plan files from the repo, not user input).
 *
 * Run: npx tsx --test tests/report-text-render.test.ts
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const ALLOWED = new Set(['components/dashboard/dashboard-client.tsx'])

function files(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => /\.(tsx|ts)$/.test(f) && !f.endsWith('.test.ts'))
    .map((f) => join(root, f))
}

test('dangerouslySetInnerHTML / innerHTML only in the allowlisted repo-docs dashboard', () => {
  const offenders = [...files('app'), ...files('components'), ...files('lib')].filter(
    (f) => /dangerouslySetInnerHTML\s*=\s*\{|\.innerHTML\s*=/.test(readFileSync(f, 'utf8')) && !ALLOWED.has(f),
  )
  assert.deepEqual(offenders, [])
})

test('report text fields are not used in page metadata', () => {
  const metadataFiles = [...files('app')].filter((f) => /generateMetadata|export const metadata/.test(readFileSync(f, 'utf8')))
  for (const f of metadataFiles) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\.(notes|tweaks|issues|customSettingsNotes)\b/, f)
  }
})
