import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// API roles can read only the public columns of public.profiles (column grants in
// supabase/migrations/20261109000500_security_hardening.sql). Private columns of the
// signed-in user come from the get_my_profile() RPC. A direct `.from('profiles')` select of a
// private column fails at runtime with "permission denied", so catch it statically.
const PRIVATE_COLUMNS = [
  'role',
  'steam_id',
  'steam_persona',
  'steam_avatar_url',
  'steam_linked_at',
  'main_cpu',
  'main_gpu',
  'main_ram',
  'preferred_resolution',
]

// Files that may read/upsert private columns because they use the service-role client.
const SERVICE_ROLE_FILES = new Set([
  join('app', 'api', 'profile', 'identity', 'route.ts'),
  join('app', 'auth', 'steam', 'callback', 'route.ts'),
  join('lib', 'server', 'admin-moderation.ts'),
])

// Columns clients may SELECT. A PostgREST upsert (INSERT ... ON CONFLICT DO UPDATE) needs
// SELECT on every column it sets, so client upserts may only carry these keys; use
// .update().eq('id', user.id) for the rig columns.
const PUBLIC_COLUMNS = [
  'id',
  'username',
  'avatar_url',
  'credibility_badge',
  'reputation_score',
  'reports_submitted',
  'votes_cast',
  'created_at',
  'updated_at',
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

function privateProfileSelects(source: string): string[] {
  const hits: string[] = []
  const re = /\.from\(\s*['"]profiles['"]\s*\)\s*\.select\(\s*(['"`])([^'"`]*)\1/g
  for (const m of source.matchAll(re)) {
    const cols = m[2].split(',').map((c) => c.trim())
    for (const col of cols) {
      if (col === '*' || PRIVATE_COLUMNS.includes(col)) hits.push(col)
    }
  }
  return hits
}

function nonPublicUpsertKeys(source: string): string[] {
  const hits: string[] = []
  const re = /\.from\(\s*['"]profiles['"]\s*\)\s*\.upsert\(\s*\{([^}]*)\}/g
  for (const m of source.matchAll(re)) {
    for (const k of m[1].matchAll(/([A-Za-z_]+)\s*:/g)) {
      if (!PUBLIC_COLUMNS.includes(k[1])) hits.push(k[1])
    }
  }
  return hits
}

test('client-scoped profile upserts only set client-readable columns', () => {
  const offenders: string[] = []
  for (const file of [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]) {
    if (SERVICE_ROLE_FILES.has(file)) continue
    const hits = nonPublicUpsertKeys(readFileSync(file, 'utf8'))
    if (hits.length) offenders.push(`${file}: ${hits.join(', ')}`)
  }
  assert.deepEqual(offenders, [], 'upsert needs SELECT on every set column; use .update().eq(\'id\', user.id)')
})

test('the upsert check flags non-public keys', () => {
  assert.deepEqual(
    nonPublicUpsertKeys(`supabase.from('profiles').upsert({ id: user.id, main_cpu: rig.cpu })`),
    ['main_cpu']
  )
  assert.deepEqual(nonPublicUpsertKeys(`supabase.from('profiles').upsert({ id: user.id, username: name })`), [])
})

test('client-scoped code never selects private profile columns directly', () => {
  const offenders: string[] = []
  for (const file of [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]) {
    if (SERVICE_ROLE_FILES.has(file)) continue
    const hits = privateProfileSelects(readFileSync(file, 'utf8'))
    if (hits.length) offenders.push(`${file}: ${hits.join(', ')}`)
  }
  assert.deepEqual(offenders, [], 'use .rpc(\'get_my_profile\') for the caller\'s private profile columns')
})

test('the static check flags a private column select', () => {
  assert.deepEqual(
    privateProfileSelects(`supabase.from('profiles').select('id, role').eq('id', x)`),
    ['role']
  )
  assert.deepEqual(privateProfileSelects(`supabase.from('profiles').select('*')`), ['*'])
  assert.deepEqual(
    privateProfileSelects(`supabase.from('profiles').select('id, username, avatar_url')`),
    []
  )
})
