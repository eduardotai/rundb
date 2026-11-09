#!/usr/bin/env node
// Test runner wrapper: finds every *.test.ts explicitly (so discovery does not depend on the
// Node version's default `--test` patterns) and FAILS if zero tests ran.
// Background: on Node 20, `tsx --test` with no arguments discovered no .ts files, and CI
// reported green with `# tests 0`.
import { readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const ROOTS = ['lib', 'tests', 'app', 'components', 'scripts']
const files = ROOTS.flatMap((root) => {
  try {
    return readdirSync(root, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.test.ts') && !f.includes('node_modules'))
      .map((f) => join(root, f))
  } catch {
    return [] // root directory absent
  }
}).sort()

if (files.length === 0) {
  console.error('[run-tests] No *.test.ts files found — refusing to report success.')
  process.exit(1)
}

const child = spawn('npx', ['tsx', '--test', '--test-reporter=tap', ...files, ...process.argv.slice(2)], {
  stdio: ['inherit', 'pipe', 'inherit'],
  shell: process.platform === 'win32',
})

let out = ''
child.stdout.on('data', (chunk) => {
  out += chunk
  process.stdout.write(chunk)
})

child.on('close', (code) => {
  const matches = [...out.matchAll(/^# tests (\d+)$/gm)]
  const count = matches.length ? Number(matches.at(-1)[1]) : 0
  if (code !== 0) process.exit(code ?? 1)
  if (count === 0) {
    console.error(`[run-tests] Zero tests ran across ${files.length} file(s) — failing.`)
    process.exit(1)
  }
  console.log(`[run-tests] ${count} tests ran across ${files.length} files.`)
})
