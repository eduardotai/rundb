#!/usr/bin/env tsx
/**
 * Re-download all mock-catalog covers at high resolution (IGDB t_original → 900px WebP).
 * Requires IGDB + Supabase keys in .env.local.
 *
 * Usage: npm run reingest:covers
 */

import { GAMES } from '../lib/mock-data'
import { loadEnvLocal } from './load-env-local'
import { execSync } from 'child_process'

loadEnvLocal()

const seeds = GAMES.map((g) => ({ name: g.name, slug: g.slug }))
process.env.SEED_JSON = JSON.stringify(seeds)

console.log(`Re-ingesting covers for ${seeds.length} games (high-res pipeline)...\n`)

execSync('npm run ingest:games', { stdio: 'inherit', cwd: process.cwd() })
