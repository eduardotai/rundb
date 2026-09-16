import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_BULK_IDS,
  cleanModeratorNotes,
  filterHardwareAliases,
  isImageStatus,
  isReportStatus,
  mapDbHardwareAlias,
  mapDbReportImage,
  normalizeBulkIds,
  parseBulkGameRows,
  validateHardwareAliasInput,
} from './admin-logic'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

test('status guards accept only known values', () => {
  assert.equal(isReportStatus('approved'), true)
  assert.equal(isReportStatus('flagged'), true)
  assert.equal(isReportStatus('deleted'), false)
  assert.equal(isReportStatus(undefined), false)
  assert.equal(isImageStatus('rejected'), true)
  assert.equal(isImageStatus('flagged'), false)
})

test('normalizeBulkIds de-duplicates, validates UUIDs and enforces the cap', () => {
  assert.deepEqual(normalizeBulkIds([UUID_A, UUID_A, ` ${UUID_B} `]), [UUID_A, UUID_B])
  assert.throws(() => normalizeBulkIds([]), /at least one/i)
  assert.throws(() => normalizeBulkIds(['not-a-uuid']), /not valid/i)
  assert.throws(() => normalizeBulkIds('abc'), /list of ids/i)
  const tooMany = Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) =>
    `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`
  )
  assert.throws(() => normalizeBulkIds(tooMany), /At most 200/)
})

test('cleanModeratorNotes trims, nulls empties and caps length', () => {
  assert.equal(cleanModeratorNotes('  hello  '), 'hello')
  assert.equal(cleanModeratorNotes('   '), null)
  assert.equal(cleanModeratorNotes(undefined), null)
  assert.equal(cleanModeratorNotes('x'.repeat(50), 10), 'x'.repeat(10))
})

test('mapDbHardwareAlias and mapDbReportImage convert snake_case rows', () => {
  assert.deepEqual(
    mapDbHardwareAlias({
      id: UUID_A,
      raw_string: 'rtx 4090',
      canonical: 'NVIDIA GeForce RTX 4090',
      vendor: null,
      series: 'RTX 40',
      created_at: '2026-01-01T00:00:00Z',
    }),
    {
      id: UUID_A,
      rawString: 'rtx 4090',
      canonical: 'NVIDIA GeForce RTX 4090',
      vendor: undefined,
      series: 'RTX 40',
      createdAt: '2026-01-01T00:00:00Z',
    }
  )

  const img = mapDbReportImage({
    id: UUID_B,
    report_id: UUID_A,
    image_url: 'https://cdn.example/x.webp',
    caption: null,
    status: 'weird',
    created_at: '2026-01-02T00:00:00Z',
  })
  assert.equal(img.status, 'pending', 'unknown statuses default to pending')
  assert.equal(img.caption, undefined)
  assert.equal(img.reportId, UUID_A)
})

test('validateHardwareAliasInput trims and enforces bounds', () => {
  assert.deepEqual(
    validateHardwareAliasInput({ rawString: '  rtx 4090 ', canonical: 'NVIDIA GeForce RTX 4090', vendor: ' NVIDIA ', series: '' }),
    { raw_string: 'rtx 4090', canonical: 'NVIDIA GeForce RTX 4090', vendor: 'NVIDIA', series: null }
  )
  assert.throws(() => validateHardwareAliasInput({ rawString: 'x', canonical: 'ok name' }), /Raw string/)
  assert.throws(() => validateHardwareAliasInput({ rawString: 'rtx 4090', canonical: '' }), /Canonical/)
})

test('filterHardwareAliases searches raw, canonical and vendor case-insensitively and sorts by raw', () => {
  const aliases = [
    { id: '1', rawString: 'rx 7900', canonical: 'AMD Radeon RX 7900 XTX', vendor: 'AMD', createdAt: '' },
    { id: '2', rawString: '4090', canonical: 'NVIDIA GeForce RTX 4090', vendor: 'NVIDIA', createdAt: '' },
  ]
  assert.deepEqual(filterHardwareAliases(aliases, 'nvidia').map((a) => a.id), ['2'])
  assert.deepEqual(filterHardwareAliases(aliases, 'RX').map((a) => a.id), ['1'])
  assert.deepEqual(filterHardwareAliases(aliases).map((a) => a.id), ['2', '1'])
})

test('parseBulkGameRows normalizes loose CSV/JSON rows and reports per-row problems', () => {
  const results = parseBulkGameRows([
    { name: "Baldur's Gate 3", developer: 'Larian', genres: 'RPG, Adventure', releaseYear: '2023', cover_url: 'https://img/x.jpg', steam_app_id: '1086940' },
    { Name: 'Duplicate', Slug: 'baldurs-gate-3' },
    { slug: 'no-name' },
    { name: 'Bad year', year: 'soon', genres: ['Action'], coverImage: 'not-a-url' },
    'garbage',
  ])

  assert.equal(results.length, 5)
  const first = results[0]
  assert.ok(first.ok)
  if (first.ok) {
    assert.equal(first.row, 2, 'rows are numbered from 2 (CSV header is row 1)')
    assert.equal(first.game.slug, 'baldurs-gate-3')
    assert.deepEqual(first.game.genres, ['RPG', 'Adventure'])
    assert.equal(first.game.releaseYear, 2023)
    assert.equal(first.game.coverUrl, 'https://img/x.jpg')
    assert.equal(first.game.steamAppId, '1086940')
    assert.equal(first.game.developer, 'Larian')
  }

  assert.deepEqual(results[1], { ok: false, row: 3, message: 'Duplicate slug in import: baldurs-gate-3' })
  assert.deepEqual(results[2], { ok: false, row: 4, message: 'Missing name' })

  const fourth = results[3]
  assert.ok(fourth.ok)
  if (fourth.ok) {
    assert.equal(fourth.game.releaseYear, null, 'unparseable years are dropped, not invented')
    assert.equal(fourth.game.coverUrl, null, 'non-http covers are dropped')
    assert.deepEqual(fourth.game.genres, ['Action'])
  }

  assert.deepEqual(results[4], { ok: false, row: 6, message: 'Row is not an object' })
})
