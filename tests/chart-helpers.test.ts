import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  TIER_ORDER,
  tierSegments,
  sortResolutions,
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
