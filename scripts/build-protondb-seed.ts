#!/usr/bin/env tsx
/**
 * Build top-N ProtonDB seed JSON from ODbL monthly dump.
 * Data: https://github.com/bdefore/protondb-data (Open Database License)
 *
 * Usage:
 *   npm run build:seed
 *   npm run build:seed -- --limit=100 --dry-run
 *   npm run build:seed -- --local-dump=./tmp/reports.tar.gz
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import { normalizeSlug } from '../lib/utils'
import { loadEnvLocal } from './load-env-local'

loadEnvLocal()

const DEFAULT_DUMP_URL =
  'https://raw.githubusercontent.com/bdefore/protondb-data/master/reports/reports_may1_2026.tar.gz'
const DEFAULT_OUT = path.join(process.cwd(), 'seeds', 'protondb-top-10k.json')
const DEFAULT_LIMIT = 10_000
const STEAM_BATCH = 20
const STEAM_DELAY_MS = 1500

export interface ProtonDbSeedEntry {
  name: string
  slug: string
  steamAppId: string
  reportCount: number
  priority: number
}

function parseArgs() {
  const args = process.argv.slice(2)
  let limit = DEFAULT_LIMIT
  let out = DEFAULT_OUT
  let localDump: string | null = null
  let dryRun = false

  for (const arg of args) {
    if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]!, 10)
    else if (arg.startsWith('--out=')) out = arg.split('=')[1]!
    else if (arg.startsWith('--local-dump=')) localDump = arg.split('=')[1]!
    else if (arg === '--dry-run') dryRun = true
  }

  return { limit, out, localDump, dryRun }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function downloadDump(url: string, dest: string): Promise<void> {
  console.log(`Downloading ProtonDB dump from ${url}...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
  console.log(`Saved ${(buf.length / 1024 / 1024).toFixed(1)} MB → ${dest}`)
}

function extractTarGz(archive: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  execSync(`tar -xzf "${archive}" -C "${destDir}"`, { stdio: 'inherit' })
}

function walkJsonFiles(dir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkJsonFiles(full))
    else if (entry.name.endsWith('.json')) out.push(full)
  }
  return out
}

function parseReportAppId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = o.appId ?? o.appid ?? o.app_id ?? o.AppId
  if (id == null) return null
  const s = String(id).trim()
  return /^\d+$/.test(s) ? s : null
}

function countReportsByAppId(jsonFiles: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  let parsed = 0

  for (const file of jsonFiles) {
    try {
      const text = fs.readFileSync(file, 'utf8')
      const data = JSON.parse(text)
      const reports = Array.isArray(data) ? data : [data]
      for (const r of reports) {
        const appId = parseReportAppId(r)
        if (appId) {
          counts.set(appId, (counts.get(appId) ?? 0) + 1)
          parsed++
        }
      }
    } catch {
      // skip malformed files
    }
  }

  console.log(`Parsed ${parsed} reports across ${counts.size} unique Steam AppIDs`)
  return counts
}

async function fetchSteamNames(appIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()

  for (let i = 0; i < appIds.length; i += STEAM_BATCH) {
    const batch = appIds.slice(i, i + STEAM_BATCH)
    const url = `https://store.steampowered.com/api/appdetails?appids=${batch.join(',')}&filters=basic`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'RunDB-SeedBuilder/1.0' } })
      if (res.ok) {
        const data = await res.json()
        for (const id of batch) {
          const entry = data[id]
          if (entry?.success && entry.data?.name) {
            names.set(id, entry.data.name as string)
          }
        }
      }
    } catch (e) {
      console.warn(`Steam batch ${i} failed:`, e)
    }
    if (i + STEAM_BATCH < appIds.length) await sleep(STEAM_DELAY_MS)
  }

  return names
}

async function main() {
  const { limit, out, localDump, dryRun } = parseArgs()
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rundb-protondb-'))
  const archivePath = localDump ?? path.join(tmpDir, 'dump.tar.gz')
  const extractDir = path.join(tmpDir, 'extracted')

  try {
    if (!localDump) {
      await downloadDump(DEFAULT_DUMP_URL, archivePath)
    } else if (!fs.existsSync(localDump)) {
      throw new Error(`Local dump not found: ${localDump}`)
    }

    console.log('Extracting archive...')
    extractTarGz(localDump ?? archivePath, extractDir)

    const jsonFiles = walkJsonFiles(extractDir)
    console.log(`Found ${jsonFiles.length} JSON files in dump`)

    const counts = countReportsByAppId(jsonFiles)
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)

    console.log(`Top ${ranked.length} games by report count — fetching Steam names...`)
    const appIds = ranked.map(([id]) => id)
    const steamNames = await fetchSteamNames(appIds)

    const seeds: ProtonDbSeedEntry[] = ranked.map(([steamAppId, reportCount], idx) => {
      const name = steamNames.get(steamAppId) ?? `Steam App ${steamAppId}`
      return {
        name,
        slug: normalizeSlug(name),
        steamAppId,
        reportCount,
        priority: idx + 1,
      }
    })

    // Deduplicate slugs (rare collisions)
    const slugSeen = new Set<string>()
    for (const s of seeds) {
      let slug = s.slug
      let n = 2
      while (slugSeen.has(slug)) {
        slug = `${s.slug}-${n++}`
      }
      slugSeen.add(slug)
      s.slug = slug
    }

    if (dryRun) {
      console.log('Dry run — top 10 preview:')
      console.log(JSON.stringify(seeds.slice(0, 10), null, 2))
      return
    }

    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(seeds, null, 2))
    console.log(`Wrote ${seeds.length} entries → ${out}`)
    console.log(
      'Attribution: ProtonDB report data © contributors, ODbL (https://opendatacommons.org/licenses/odbl/)'
    )
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
