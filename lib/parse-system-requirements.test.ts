import assert from 'node:assert/strict';
import test from 'node:test';

import {
  splitHardwareAlternatives,
  stripRequirementFluff,
  parseHardwareSpecSide,
  parseSteamRequirementsHtml,
  extractOfficialReqsFromPcRequirements,
  officialReqsDbPatch,
} from './parse-system-requirements';

test('splitHardwareAlternatives: slash dual vendor', () => {
  assert.deepEqual(
    splitHardwareAlternatives('Intel i5-3570K / AMD FX-8310'),
    ['Intel i5-3570K', 'AMD FX-8310']
  );
});

test('splitHardwareAlternatives: or / OR separators', () => {
  assert.deepEqual(
    splitHardwareAlternatives('Intel Core i5-8400 or AMD Ryzen 5 1600'),
    ['Intel Core i5-8400', 'AMD Ryzen 5 1600']
  );
  assert.deepEqual(
    splitHardwareAlternatives('GTX 1060 OR RX 580'),
    ['GTX 1060', 'RX 580']
  );
});

test('splitHardwareAlternatives: single candidate stays one', () => {
  assert.deepEqual(splitHardwareAlternatives('RTX 4070'), ['RTX 4070']);
});

test('stripRequirementFluff: removes or better / equivalent', () => {
  assert.equal(
    stripRequirementFluff('Intel Core i5-8400 or better'),
    'Intel Core i5-8400'
  );
  assert.equal(
    stripRequirementFluff('GTX 1060 6GB or equivalent'),
    'GTX 1060 6GB'
  );
});

test('parseHardwareSpecSide: dual CPU/GPU + RAM from HardwareSpec', () => {
  const parsed = parseHardwareSpecSide({
    cpu: 'Intel i5-8400 / AMD Ryzen 3 3300X',
    gpu: 'GTX 1060 6GB / RX 580',
    ram: 12,
  });
  assert.deepEqual(parsed.cpuCandidates, ['Intel i5-8400', 'AMD Ryzen 3 3300X']);
  assert.deepEqual(parsed.gpuCandidates, ['GTX 1060 6GB', 'RX 580']);
  assert.equal(parsed.ramGB, 12);
  assert.equal(parsed.parseQuality, 'good');
});

test('parseHardwareSpecSide: missing GPU is partial', () => {
  const parsed = parseHardwareSpecSide({
    cpu: 'Intel i5-8400',
    gpu: '',
    ram: 8,
  });
  assert.equal(parsed.gpuCandidates.length, 0);
  assert.equal(parsed.parseQuality, 'partial');
});

test('parseHardwareSpecSide: empty input is poor', () => {
  const parsed = parseHardwareSpecSide(undefined);
  assert.equal(parsed.parseQuality, 'poor');
  assert.equal(parsed.ramGB, null);
});

test('parseSteamRequirementsHtml: extracts Processor, Graphics, Memory', () => {
  const html = `
    <strong>Minimum:</strong><br>
    <ul class="bb_ul">
      <li><strong>OS:</strong> Windows 10<br></li>
      <li><strong>Processor:</strong> Intel Core i5-8400 or AMD Ryzen 5 1600<br></li>
      <li><strong>Memory:</strong> 16 GB RAM<br></li>
      <li><strong>Graphics:</strong> NVIDIA GeForce GTX 1060 6GB / AMD Radeon RX 580<br></li>
      <li><strong>Storage:</strong> 70 GB available space</li>
    </ul>
  `;
  const spec = parseSteamRequirementsHtml(html);
  assert.ok(spec);
  assert.match(spec!.cpu, /i5-8400/i);
  assert.match(spec!.gpu, /GTX 1060|RX 580/i);
  assert.equal(spec!.ram, 16);
  assert.equal(spec!.storage, '70 GB available space');
});

test('parseSteamRequirementsHtml: empty or garbage returns null', () => {
  assert.equal(parseSteamRequirementsHtml(''), null);
  assert.equal(parseSteamRequirementsHtml('<p>hello</p>'), null);
});

const SAMPLE_MIN_HTML = `
  <strong>Minimum:</strong><br>
  <ul class="bb_ul">
    <li><strong>OS:</strong> Windows 10<br></li>
    <li><strong>Processor:</strong> Intel Core i5-8400 or AMD Ryzen 5 1600<br></li>
    <li><strong>Memory:</strong> 16 GB RAM<br></li>
    <li><strong>Graphics:</strong> NVIDIA GeForce GTX 1060 6GB / AMD Radeon RX 580<br></li>
    <li><strong>Storage:</strong> 70 GB available space</li>
  </ul>
`;

const SAMPLE_REC_HTML = `
  <strong>Recommended:</strong><br>
  <ul class="bb_ul">
    <li><strong>Processor:</strong> Intel Core i7-8700K or AMD Ryzen 5 3600<br></li>
    <li><strong>Memory:</strong> 16 GB RAM<br></li>
    <li><strong>Graphics:</strong> NVIDIA GeForce RTX 2060 / AMD Radeon RX 5700 XT<br></li>
  </ul>
`;

test('extractOfficialReqsFromPcRequirements: object with min+rec HTML', () => {
  const out = extractOfficialReqsFromPcRequirements({
    minimum: SAMPLE_MIN_HTML,
    recommended: SAMPLE_REC_HTML,
  });
  assert.ok(out.min);
  assert.ok(out.rec);
  assert.equal(out.min!.ram, 16);
  assert.match(out.min!.cpu, /i5-8400/i);
  assert.match(out.rec!.gpu, /RTX 2060|RX 5700/i);
});

test('extractOfficialReqsFromPcRequirements: empty array → nulls', () => {
  const out = extractOfficialReqsFromPcRequirements([]);
  assert.equal(out.min, null);
  assert.equal(out.rec, null);
});

test('extractOfficialReqsFromPcRequirements: only minimum', () => {
  const out = extractOfficialReqsFromPcRequirements({ minimum: SAMPLE_MIN_HTML });
  assert.ok(out.min);
  assert.equal(out.rec, null);
});

test('extractOfficialReqsFromPcRequirements: null/undefined/garbage', () => {
  assert.deepEqual(extractOfficialReqsFromPcRequirements(null), { min: null, rec: null });
  assert.deepEqual(extractOfficialReqsFromPcRequirements(undefined), { min: null, rec: null });
  assert.deepEqual(extractOfficialReqsFromPcRequirements('nope'), { min: null, rec: null });
});

test('officialReqsDbPatch: only includes non-null sides', () => {
  assert.deepEqual(officialReqsDbPatch({ min: null, rec: null }), {});
  const minOnly = officialReqsDbPatch({
    min: { cpu: 'i5', gpu: 'GTX', ram: 8 },
    rec: null,
  });
  assert.ok(minOnly.official_min_reqs);
  assert.equal(minOnly.official_rec_reqs, undefined);
});
