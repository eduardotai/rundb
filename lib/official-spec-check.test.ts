import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateOfficialSpecs } from './official-spec-check';
import type { Game, UserPC } from './types';

function gameWith(
  min?: { cpu: string; gpu: string; ram: number },
  rec?: { cpu: string; gpu: string; ram: number }
): Pick<Game, 'officialMinReqs' | 'officialRecReqs'> {
  return {
    officialMinReqs: min,
    officialRecReqs: rec,
  };
}

const highEnd: UserPC = {
  cpu: 'Ryzen 7 7800X3D',
  gpu: 'RTX 4070',
  ram: 32,
  resolution: '2560x1440',
};

const midRig: UserPC = {
  cpu: 'Ryzen 5 3600',
  gpu: 'RTX 2060',
  ram: 16,
  resolution: '1920x1080',
};

const lowRam: UserPC = {
  cpu: 'Ryzen 5 3600',
  gpu: 'RTX 3070',
  ram: 8,
  resolution: '1920x1080',
};

// Elden Ring-ish min/rec using catalog-covered parts
const eldenMin = {
  cpu: 'Intel i5-8400 / AMD Ryzen 5 1600',
  gpu: 'GTX 1060 6GB / RX 580',
  ram: 12,
};
const eldenRec = {
  cpu: 'Intel i7-8700K / AMD Ryzen 5 3600',
  gpu: 'RTX 2060 / RX 5700 XT',
  ram: 16,
};

test('evaluateOfficialSpecs: empty requirements → unknown', () => {
  const r = evaluateOfficialSpecs(highEnd, gameWith());
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.source, 'official_min_rec');
  assert.ok(r.limitations.length >= 1);
});

test('evaluateOfficialSpecs: high-end vs mid min/rec → exceeds or meets recommended', () => {
  const r = evaluateOfficialSpecs(highEnd, gameWith(eldenMin, eldenRec));
  assert.ok(
    r.verdict === 'exceeds_recommended' || r.verdict === 'meets_recommended',
    `expected meets/exceeds rec, got ${r.verdict}`
  );
  assert.equal(r.min?.overall, 'pass');
  assert.equal(r.rec?.overall, 'pass');
  assert.ok(r.confidence > 0.4);
});

test('evaluateOfficialSpecs: mid rig between min and rec (or meets rec depending on catalog)', () => {
  // RTX 2060 is on rec GPU list for eldenRec → may meet rec
  // Use a rec GPU clearly above mid for between case
  const recHigher = {
    cpu: 'Intel i7-8700K / AMD Ryzen 7 3700X',
    gpu: 'RTX 3070',
    ram: 16,
  };
  const r = evaluateOfficialSpecs(midRig, gameWith(eldenMin, recHigher));
  assert.equal(r.min?.overall, 'pass');
  // mid GPU 2060 (perf ~22) vs 3070 (~44) should fail rec GPU
  assert.equal(r.rec?.gpu, 'fail');
  assert.ok(
    r.verdict === 'between_min_and_rec' || r.verdict === 'meets_minimum',
    `got ${r.verdict}`
  );
});

test('evaluateOfficialSpecs: dual-vendor min — AMD side only still passes min', () => {
  const amdOnly: UserPC = {
    cpu: 'Ryzen 5 1600',
    gpu: 'RX 580',
    ram: 16,
  };
  const r = evaluateOfficialSpecs(amdOnly, gameWith(eldenMin, eldenRec));
  assert.equal(r.min?.cpu, 'pass');
  assert.equal(r.min?.gpu, 'pass');
  assert.equal(r.min?.overall, 'pass');
  assert.ok(r.verdict !== 'below_minimum');
});

test('evaluateOfficialSpecs: dual-vendor min — Intel side only still passes min', () => {
  const intelOnly: UserPC = {
    cpu: 'i5-8400',
    gpu: 'GTX 1060 6GB',
    ram: 16,
  };
  const r = evaluateOfficialSpecs(intelOnly, gameWith(eldenMin));
  assert.equal(r.min?.cpu, 'pass');
  assert.equal(r.min?.gpu, 'pass');
  assert.equal(r.verdict, 'meets_minimum');
});

test('evaluateOfficialSpecs: RAM below min → below_minimum (strict)', () => {
  const r = evaluateOfficialSpecs(lowRam, gameWith({ ...eldenMin, ram: 16 }, eldenRec));
  assert.equal(r.min?.ram, 'fail');
  assert.equal(r.min?.overall, 'fail');
  assert.equal(r.verdict, 'below_minimum');
});

test('evaluateOfficialSpecs: unparseable GPU → unknown component, not false pass', () => {
  const r = evaluateOfficialSpecs(highEnd, gameWith({
    cpu: 'Intel i5-8400',
    gpu: 'DirectX 11 compatible video card',
    ram: 8,
  }));
  assert.equal(r.min?.gpu, 'unknown');
  // Cannot hard-pass overall when GPU unknown
  assert.notEqual(r.min?.overall, 'pass');
  assert.ok(r.verdict === 'unknown' || r.verdict === 'below_minimum');
});

test('evaluateOfficialSpecs: incomplete rig (empty gpu) → unknown', () => {
  const incomplete: UserPC = { cpu: 'Ryzen 5 3600', gpu: '', ram: 16 };
  const r = evaluateOfficialSpecs(incomplete, gameWith(eldenMin));
  assert.equal(r.verdict, 'unknown');
});

test('evaluateOfficialSpecs: only recommended present', () => {
  const r = evaluateOfficialSpecs(highEnd, gameWith(undefined, eldenRec));
  assert.ok(
    r.verdict === 'meets_recommended' || r.verdict === 'exceeds_recommended',
    `got ${r.verdict}`
  );
  assert.ok(!r.min);
  assert.ok(r.rec);
});

test('evaluateOfficialSpecs: explanation and limitations always present', () => {
  const r = evaluateOfficialSpecs(highEnd, gameWith(eldenMin, eldenRec));
  assert.ok(r.explanation.length > 10);
  assert.ok(r.limitations.some((l) => /publisher|official|community/i.test(l)));
});
