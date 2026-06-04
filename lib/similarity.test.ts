import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateHardwareAwareSimilarity,
  calculateMatchBreakdown,
  rankAndFilterMatches,
} from './similarity';
import type { Report, UserPC } from './types';

function makeReport(over: Partial<Report>): Report {
  return {
    id: 'r1',
    gameId: 'g1',
    gameName: 'Test Game',
    cpu: 'Ryzen 7 7800X3D',
    gpu: 'RTX 4070',
    ram: 32,
    resolution: '2560x1440',
    settingsPreset: 'High',
    avgFps: 90,
    performanceTier: 'Good',
    createdAt: '2026-01-01T00:00:00.000Z',
    helpfulVotes: 0,
    ...over,
  };
}

const rig: UserPC = {
  cpu: 'Ryzen 7 7800X3D',
  gpu: 'RTX 4070',
  ram: 32,
  resolution: '2560x1440',
};

test('calculateMatchBreakdown: identical hardware buckets as exact', () => {
  const b = calculateMatchBreakdown(makeReport({}), rig);
  assert.equal(b.gpu, 'exact');
  assert.equal(b.cpu, 'exact');
  assert.equal(b.ram, 'exact');
  assert.equal(b.resolution, true);
});

test('calculateMatchBreakdown: unknown hardware buckets as far', () => {
  const b = calculateMatchBreakdown(makeReport({ gpu: 'zzz999', cpu: 'zzz999' }), rig);
  assert.equal(b.gpu, 'far');
  assert.equal(b.cpu, 'far');
});

test('calculateMatchBreakdown: ram diff buckets (exact/close/far)', () => {
  assert.equal(calculateMatchBreakdown(makeReport({ ram: 32 }), rig).ram, 'exact');
  assert.equal(calculateMatchBreakdown(makeReport({ ram: 28 }), rig).ram, 'close');
  assert.equal(calculateMatchBreakdown(makeReport({ ram: 8 }), rig).ram, 'far');
});

test('calculateMatchBreakdown: resolution mismatch is false', () => {
  assert.equal(calculateMatchBreakdown(makeReport({ resolution: '3840x2160' }), rig).resolution, false);
});

test('calculateMatchBreakdown: score equals calculateHardwareAwareSimilarity', () => {
  const r = makeReport({});
  assert.equal(calculateMatchBreakdown(r, rig).score, calculateHardwareAwareSimilarity(r, rig));
});

test('rankAndFilterMatches: threshold hides weak matches', () => {
  const strong = makeReport({ id: 'strong' });
  const weak = makeReport({ id: 'weak', gpu: 'zzz999', cpu: 'zzz999', ram: 8 });
  const out = rankAndFilterMatches([strong, weak], rig, { minScore: 60 });
  assert.deepEqual(out.map((m) => m.report.id), ['strong']);
});

test('rankAndFilterMatches: minScore 0 keeps everything', () => {
  const a = makeReport({ id: 'a' });
  const b = makeReport({ id: 'b', gpu: 'zzz999' });
  const out = rankAndFilterMatches([a, b], rig, { minScore: 0 });
  assert.equal(out.length, 2);
});

test('rankAndFilterMatches: filters by game, resolution, tier', () => {
  const a = makeReport({ id: 'a', gameId: 'g1', resolution: '2560x1440', performanceTier: 'Good' });
  const b = makeReport({ id: 'b', gameId: 'g2', resolution: '3840x2160', performanceTier: 'Excellent' });
  assert.deepEqual(
    rankAndFilterMatches([a, b], rig, { minScore: 0, gameId: 'g1' }).map((m) => m.report.id),
    ['a']
  );
  assert.deepEqual(
    rankAndFilterMatches([a, b], rig, { minScore: 0, resolution: '3840x2160' }).map((m) => m.report.id),
    ['b']
  );
  assert.deepEqual(
    rankAndFilterMatches([a, b], rig, { minScore: 0, tier: 'Excellent' }).map((m) => m.report.id),
    ['b']
  );
});

test('rankAndFilterMatches: sort by fps and newest', () => {
  const slowNew = makeReport({ id: 'slowNew', avgFps: 30, createdAt: '2026-05-01T00:00:00.000Z' });
  const fastOld = makeReport({ id: 'fastOld', avgFps: 200, createdAt: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(
    rankAndFilterMatches([slowNew, fastOld], rig, { minScore: 0, sort: 'fps' }).map((m) => m.report.id),
    ['fastOld', 'slowNew']
  );
  assert.deepEqual(
    rankAndFilterMatches([slowNew, fastOld], rig, { minScore: 0, sort: 'newest' }).map((m) => m.report.id),
    ['slowNew', 'fastOld']
  );
});

test('rankAndFilterMatches: default sort is match score descending', () => {
  const a = makeReport({ id: 'a' });
  const b = makeReport({ id: 'b', gpu: 'zzz999' });
  const out = rankAndFilterMatches([a, b], rig, { minScore: 0 });
  assert.ok(out[0].score >= out[1].score);
});
