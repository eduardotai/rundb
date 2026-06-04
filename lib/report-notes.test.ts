import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanPublicReportNotes } from './report-notes'

test('cleanPublicReportNotes hides catalog moderation markers from public cards', () => {
  assert.equal(cleanPublicReportNotes('[Catalog: unknown hardware]'), undefined)
  assert.equal(
    cleanPublicReportNotes('[Catalog: unknown hardware] Runs well after shader cache warms up.'),
    'Runs well after shader cache warms up.'
  )
})
