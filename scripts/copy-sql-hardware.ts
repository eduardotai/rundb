/**
 * Copy supabase/incremental-hardware-catalog.sql to the system clipboard (cross-platform).
 *
 *   npm run copy:sql:hardware
 *
 * Uses the native clipboard tool for the current OS (pbcopy / clip / wl-copy / xclip / xsel).
 * If none is available (e.g. headless Linux), prints the SQL to stdout so it can be piped.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SQL_PATH = path.join(process.cwd(), 'supabase', 'incremental-hardware-catalog.sql')

function clipboardCommands(): Array<{ cmd: string; args: string[] }> {
  switch (process.platform) {
    case 'darwin':
      return [{ cmd: 'pbcopy', args: [] }]
    case 'win32':
      return [{ cmd: 'clip', args: [] }]
    default:
      return [
        { cmd: 'wl-copy', args: [] },
        { cmd: 'xclip', args: ['-selection', 'clipboard'] },
        { cmd: 'xsel', args: ['--clipboard', '--input'] },
      ]
  }
}

function copyToClipboard(text: string): boolean {
  for (const { cmd, args } of clipboardCommands()) {
    const result = spawnSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] })
    if (!result.error && result.status === 0) return true
  }
  return false
}

const sql = readFileSync(SQL_PATH, 'utf8')

if (copyToClipboard(sql)) {
  console.log('✅ Clean hardware catalog SQL copied to clipboard.')
  console.log(
    "Paste into YOUR Supabase project's SQL Editor (project dashboard > SQL Editor, or https://supabase.com/dashboard/project/YOUR_REF/sql/new)."
  )
  console.log('First line must start with a -- comment. If you see > or npm output, re-run this command.')
} else {
  console.error('⚠️  No clipboard tool found (pbcopy / clip / wl-copy / xclip / xsel). Printing SQL to stdout instead:\n')
  process.stdout.write(sql)
}
