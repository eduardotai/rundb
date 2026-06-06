import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  TIER_ORDER,
  tierSegments,
  sortResolutions,
  resolutionArea,
  fpsBarPct,
  fpsBucket,
} from '../lib/chart-helpers'

test('tierSegments returns all five tiers in order with pct + rawPct', () => {
  const dist = { Excellent: 2, Good: 1, Playable: 1, Struggling: 0, Unplayable: 0 }
  const segs = tierSegments(dist, 4)
  assert.deepEqual(segs.map((s) => s.tier), TIER_ORDER)
  assert.equal(segs[0].count, 2)
  assert.equal(segs[0].pct, 50)
  assert.equal(segs[0].rawPct, 50)
  assert.equal(segs[3].count, 0)
  assert.equal(segs[3].pct, 0)
})

test('tierSegments with zero total yields all-zero, no divide-by-zero', () => {
  const dist = { Excellent: 0, Good: 0, Playable: 0, Struggling: 0, Unplayable: 0 }
  const segs = tierSegments(dist, 0)
  assert.equal(segs.length, 5)
  for (const s of segs) {
    assert.equal(s.pct, 0)
    assert.equal(s.rawPct, 0)
  }
})

test('sortResolutions orders by pixel area, most demanding first', () => {
  const out = sortResolutions(['1920x1080', '3840x2160', '2560x1440'])
  assert.deepEqual(out, ['3840x2160', '2560x1440', '1920x1080'])
})

// '1440p' and '2560×1440' have equal pixel area (2560*1440), so their relative
// order after '4K' verifies stable tie-breaking by original input index.
test('sortResolutions understands shorthand and unicode multiplier', () => {
  const out = sortResolutions(['1080p', '4K', '1440p', '2560×1440'])
  assert.deepEqual(out, ['4K', '1440p', '2560×1440', '1080p'])
})

test('sortResolutions puts unparseable keys last, stably', () => {
  const out = sortResolutions(['ultrawide', '1920x1080', 'potato'])
  assert.deepEqual(out, ['1920x1080', 'ultrawide', 'potato'])
})

test('fpsBarPct is proportional and clamped', () => {
  assert.equal(fpsBarPct(60, 120), 50)
  assert.equal(fpsBarPct(0, 120), 0)
  assert.equal(fpsBarPct(200, 120), 100)
  assert.equal(fpsBarPct(60, 0), 0)
})

test('fpsBucket boundaries', () => {
  assert.equal(fpsBucket(29), 'low')
  assert.equal(fpsBucket(30), 'ok')
  assert.equal(fpsBucket(59), 'ok')
  assert.equal(fpsBucket(60), 'good')
  assert.equal(fpsBucket(119), 'good')
  assert.equal(fpsBucket(120), 'high')
})

test('fpsBucket and fpsBarPct guard non-finite input', () => {
  assert.equal(fpsBucket(NaN), 'low')
  assert.equal(fpsBucket(-1), 'low')
  assert.equal(fpsBarPct(NaN, 120), 0)
  assert.equal(fpsBarPct(60, NaN), 0)
})

test('resolutionArea parses formats and returns null for junk', () => {
  assert.equal(resolutionArea('2560×1440'), 2560 * 1440)
  assert.equal(resolutionArea('1080p'), 1920 * 1080)
  assert.equal(resolutionArea('4K'), 3840 * 2160)
  assert.equal(resolutionArea('garbage'), null)
  assert.equal(resolutionArea(''), null)
})
