/**
 * Static guard: public report reads must only count approved reports.
 *
 * RLS lets owners see their own pending reports and moderators see every status, so a
 * query without an explicit status filter leaks pending/rejected reports into public
 * lists and aggregates for those users. Every `.from('reports')` in the public data
 * adapter (lib/data.ts + lib/data-queries.ts) must carry `.eq('status', 'approved')` in the same query chain.
 *
 * Run: npx tsx --test tests/report-public-reads.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/** Query chain text from `.from('reports')` up to the end of the statement/expression. */
function reportQueries(source: string): string[] {
  const out: string[] = []
  const re = /\.from\('reports'\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    const rest = source.slice(m.index)
    // A chain ends at the first `;`, `\n\n` or a closing `,\n` of an argument list.
    const end = rest.search(/;|\n\s*\n|\),\s*\n\s*'/)
    out.push(rest.slice(0, end === -1 ? 400 : end))
  }
  return out
}

// lib/data-queries.ts holds the injected-client query cores that lib/data.ts calls.
const PUBLIC_READ_FILES = ['lib/data.ts', 'lib/data-queries.ts']

test('every public report query in lib/data.ts and lib/data-queries.ts filters status = approved', () => {
  const queries = PUBLIC_READ_FILES.flatMap((f) => reportQueries(readFileSync(f, 'utf8')))
  assert.ok(queries.length >= 10, `expected the known public report reads, found ${queries.length}`)
  const missing = queries.filter((q) => !q.includes(".eq('status', 'approved')"))
  assert.deepEqual(missing, [], 'public report reads without an approved filter')
})

test('report submit/edit actions delegate to the validated core and never hardcode a status', () => {
  const src = readFileSync('app/actions/reports.ts', 'utf8')
  assert.match(src, /await submitReport\(deps, input\)/)
  assert.match(src, /await updateReport\(deps, reportId, input\)/)
  assert.doesNotMatch(src, /status:\s*'approved'/)
  // The insert/update into reports only happens through the deps wired for the core.
  assert.equal((src.match(/service\.from\('reports'\)\s*\.insert/g) ?? []).length, 1)
})
