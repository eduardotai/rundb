import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('vote total recomputation preserves staff moderation decisions', () => {
  const sql = readFileSync('supabase/incremental-reputation-voting.sql', 'utf8')

  assert.match(
    sql,
    /WHEN status = 'rejected'::report_status THEN status/,
    'rejected reports must not be auto-approved by vote recomputation'
  )
  assert.match(
    sql,
    /WHEN moderated_by IS NOT NULL AND status = 'flagged'::report_status THEN status/,
    'staff-flagged reports must not be auto-approved by vote recomputation'
  )
})
