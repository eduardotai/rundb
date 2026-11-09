/**
 * Next.js 16 answers 400 on /_next/image for any `quality` missing from
 * `images.qualities` in next.config.ts. Guard: every literal `quality={N}` passed to
 * next/image in app/ and components/ must be allowlisted.
 *
 * Run: npx tsx --test tests/image-qualities.test.ts
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import nextConfig from '../next.config'

function tsxFiles(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(root, f))
}

test('every literal next/image quality is in images.qualities', () => {
  const allowed = new Set(nextConfig.images?.qualities ?? [75])
  const used = new Map<number, string[]>()
  for (const file of [...tsxFiles('app'), ...tsxFiles('components')]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bquality=\{(\d+)\}/g)) {
      const q = Number(m[1])
      used.set(q, [...(used.get(q) ?? []), file])
    }
  }
  assert.ok(used.size > 0, 'expected some quality props')
  const missing = [...used].filter(([q]) => !allowed.has(q))
  assert.deepEqual(missing, [], 'quality values missing from next.config.ts images.qualities')
})
