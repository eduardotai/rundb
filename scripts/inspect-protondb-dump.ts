import { execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const url =
  'https://raw.githubusercontent.com/bdefore/protondb-data/master/reports/reports_may1_2026.tar.gz'
const tmp = path.join(os.tmpdir(), 'pdb-inspect')
const gz = path.join(tmp, 'dump.tar.gz')
const out = path.join(tmp, 'extracted')

async function main() {
  fs.mkdirSync(tmp, { recursive: true })
  console.log('Downloading...')
  const r = await fetch(url)
  fs.writeFileSync(gz, Buffer.from(await r.arrayBuffer()))
  console.log('Listing tar (first 40)...')
  const listing = execSync(`tar -tzf "${gz}"`, { maxBuffer: 50 * 1024 * 1024 })
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
  listing.slice(0, 40).forEach((l) => console.log(l))
  console.log('total entries:', listing.length)
  console.log('json files:', listing.filter((f) => f.endsWith('.json')).length)

  fs.mkdirSync(out, { recursive: true })
  execSync(`tar -xzf "${gz}" -C "${out}"`, { stdio: 'inherit' })

  function walk(dir: string): string[] {
    const files: string[] = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) files.push(...walk(p))
      else files.push(p)
    }
    return files
  }

  const all = walk(out)
  console.log('extracted files:', all.length)
  const json = all.filter((f) => f.endsWith('.json'))
  console.log('extracted json:', json.length)
  if (json[0]) {
    const sample = fs.readFileSync(json[0], 'utf8').slice(0, 800)
    console.log('sample path:', json[0])
    console.log('sample content:', sample)
  }
}

main().catch(console.error)
