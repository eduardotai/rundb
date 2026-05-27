#!/usr/bin/env tsx
/**
 * One-shot Supabase setup for real-data mode:
 * 1. Apply missing schema (game_media) via Management API or DATABASE_URL
 * 2. Refresh API keys into .env.local (optional, requires SUPABASE_ACCESS_TOKEN)
 * 3. Seed games from mock catalog (requires valid service role)
 * 4. Run IGDB ingest if credentials present
 *
 * Prerequisites (pick one path for SQL):
 *   A) SUPABASE_ACCESS_TOKEN in .env.local — from https://supabase.com/dashboard/account/tokens
 *   B) DATABASE_URL in .env.local — from Dashboard → Connect → URI (percent-encoded for CLI)
 *   C) Run `npx supabase login` then use --linked via CLI manually
 *
 * Usage: npm run setup:supabase
 */

import { writeFileSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { loadEnvLocal } from './load-env-local'

const PROJECT_REF = 'gyldcsduuzoqqamyudni'
const ENV_PATH = resolve(process.cwd(), '.env.local')
const INCREMENTAL_SQL = resolve(process.cwd(), 'supabase/incremental-game-media.sql')

function loadEnvMap(): Record<string, string> {
  loadEnvLocal()
  const env: Record<string, string> = {}
  if (!existsSync(ENV_PATH)) return env
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function setEnvKey(key: string, value: string) {
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, `${key}=${value}\n`, 'utf8')
    return
  }
  const lines = readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
  let found = false
  const out = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true
      return `${key}=${value}`
    }
    return line
  })
  if (!found) out.push(`${key}=${value}`)
  writeFileSync(ENV_PATH, out.join('\n'), 'utf8')
  process.env[key] = value
}

async function managementQuery(accessToken: string, sql: string): Promise<void> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Management API SQL failed (${res.status}): ${body}`)
  }
}

async function refreshLegacyApiKeys(accessToken: string): Promise<boolean> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    console.warn(`Could not fetch API keys (${res.status}). Update keys manually in dashboard.`)
    return false
  }
  const raw = await res.json()
  const rows = Array.isArray(raw) ? raw : []
  let updated = false
  for (const row of rows) {
    const name = String(row.name || '').toLowerCase()
    const key = row.api_key as string | undefined
    if (!key || row.type !== 'legacy') continue
    if (name === 'service_role') {
      setEnvKey('SUPABASE_SERVICE_ROLE_KEY', key)
      console.log('Updated SUPABASE_SERVICE_ROLE_KEY in .env.local')
      updated = true
    } else if (name === 'anon') {
      setEnvKey('NEXT_PUBLIC_SUPABASE_ANON_KEY', key)
      console.log('Updated NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
      updated = true
    }
  }
  if (!updated) {
    console.warn('No legacy anon/service_role keys found in Management API response.')
  }
  return updated
}

async function applyIncrementalSchema(env: Record<string, string>): Promise<boolean> {
  const sql = readFileSync(INCREMENTAL_SQL, 'utf8')

  if (env.SUPABASE_ACCESS_TOKEN) {
    console.log('Applying incremental schema via Supabase Management API...')
    await managementQuery(env.SUPABASE_ACCESS_TOKEN, sql)
    console.log('Schema applied (game_media).')
    return true
  }

  const dbUrl = env.DATABASE_URL || env.SUPABASE_DB_URL
  if (dbUrl) {
    console.log('Applying incremental schema via supabase db query --db-url...')
    execSync(`npx supabase db query -f "${INCREMENTAL_SQL}" --db-url "${dbUrl}"`, {
      stdio: 'inherit',
      cwd: process.cwd(),
    })
    console.log('Schema applied (game_media).')
    return true
  }

  return false
}

async function main() {
  const env = loadEnvMap()
  console.log('RunDB Supabase real-mode setup\n')

  const accessToken = env.SUPABASE_ACCESS_TOKEN
  if (accessToken) {
    console.log('Refreshing API keys from Management API...')
    await refreshLegacyApiKeys(accessToken)
    loadEnvLocal()
  } else {
    console.log(
      'Tip: add SUPABASE_ACCESS_TOKEN to .env.local to auto-refresh revoked API keys and apply SQL remotely.'
    )
  }

  const schemaOk = await applyIncrementalSchema(env)
  if (!schemaOk) {
    console.log('\nCould not apply SQL automatically.')
    console.log('Paste this file into Supabase SQL Editor and click Run:')
    console.log(`  ${INCREMENTAL_SQL}`)
    console.log(`  https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`)
  }

  loadEnvLocal()
  console.log('\nSeeding games from mock catalog...')
  try {
    execSync('npm run seed:games', { stdio: 'inherit', cwd: process.cwd() })
  } catch {
    console.error(
      '\nSeed failed. If you see "Invalid API key", regenerate keys at:'
    )
    console.error(`  https://supabase.com/dashboard/project/${PROJECT_REF}/settings/api`)
    console.error('  Copy service_role into SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  if (env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET) {
    console.log('\nRunning IGDB ingest...')
    execSync('npm run ingest:games', { stdio: 'inherit', cwd: process.cwd() })
  } else {
    console.log('\nSkipping IGDB ingest (IGDB_CLIENT_ID / IGDB_CLIENT_SECRET not in .env.local).')
    console.log('Get credentials: https://dev.twitch.tv/console/apps → create app → use as IGDB OAuth.')
  }

  console.log('\nSetup complete. Restart the dev server: npm run dev')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
