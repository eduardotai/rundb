import assert from 'node:assert/strict'
import test from 'node:test'

import {
  cleanGpuString,
  cleanCpuString,
  normalizeDetectedGpu,
  normalizeDetectedCpu,
  parsePaste,
  parseStructuredJson,
  mergeDetected,
  deviceMemoryToHint,
  hardwareConcurrencyToMeta,
} from './hardware-detector'

// ---------------------------------------------------------------------------
// cleanGpuString — ANGLE wrapper, PCI id, and render-API noise stripping.
// These run before sanitizeFullName, which strips parens/brackets, so all the
// structural parsing must happen here.
// ---------------------------------------------------------------------------

test('cleanGpuString unwraps ANGLE NVIDIA (Chrome/Edge Windows dominant case)', () => {
  assert.equal(
    cleanGpuString('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    'NVIDIA GeForce RTX 4070 Ti'
  )
})

test('cleanGpuString unwraps ANGLE AMD', () => {
  assert.equal(
    cleanGpuString('ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    'AMD Radeon RX 7800 XT'
  )
})

test('cleanGpuString picks the discrete/model segment from a multi-vendor / iGPU ANGLE string', () => {
  assert.equal(
    cleanGpuString('ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    'Intel UHD Graphics 630'
  )
})

test('cleanGpuString still strips legacy WebGL /PCIe/SSE2 noise (regression guard)', () => {
  assert.equal(cleanGpuString('NVIDIA GeForce RTX 3060/PCIe/SSE2'), 'NVIDIA GeForce RTX 3060')
})

// ---------------------------------------------------------------------------
// normalizeDetectedGpu — clean → sanitize → catalog normalize.
// ---------------------------------------------------------------------------

test('normalizeDetectedGpu maps an ANGLE NVIDIA string to a canonical catalog entry + perfIndex', () => {
  const r = normalizeDetectedGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti (0x00002782) Direct3D11 vs_5_0 ps_5_0, D3D11)')
  assert.equal(r.canonical, 'NVIDIA GeForce RTX 4070 Ti')
  assert.equal(r.display, 'NVIDIA GeForce RTX 4070 Ti')
  assert.notEqual(r.method, 'none')
  assert.ok(typeof r.entry?.perfIndex === 'number', 'expected a perfIndex from the catalog entry')
})

test('normalizeDetectedGpu maps ANGLE AMD to canonical', () => {
  const r = normalizeDetectedGpu('ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0 ps_5_0, D3D11)')
  assert.equal(r.canonical, 'AMD Radeon RX 7800 XT')
})

test('normalizeDetectedGpu falls back to the cleaned string when unmatched', () => {
  const r = normalizeDetectedGpu('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)')
  assert.equal(r.method, 'none')
  assert.ok(/Basic Render/i.test(r.display), 'should keep the cleaned string as display')
})

// ---------------------------------------------------------------------------
// parsePaste — multi-format extraction + canonical normalization.
// ---------------------------------------------------------------------------

test('parsePaste handles Windows dxdiag (RTX 4070 + Ryzen 7800X3D)', () => {
  const dxdiag = [
    'Processor: AMD Ryzen 7 7800X3D 8-Core Processor (16 CPUs), ~4.0GHz',
    'Memory: 32768MB RAM',
    '[Display Devices]',
    'Card name: NVIDIA GeForce RTX 4070',
    'Dedicated Memory: 12115 MB',
    'Current Resolution: 2560x1440 (32 bit) (144Hz)',
    'Windows 11 Pro',
  ].join('\n')
  const r = parsePaste(dxdiag)
  assert.equal(r.method, 'paste')
  assert.equal(r.osHint, 'Windows')
  assert.ok(r.gpu?.includes('RTX 4070'), `gpu was ${r.gpu}`)
  assert.ok(r.cpu?.includes('7800X3D'), `cpu was ${r.cpu}`)
  assert.equal(r.resolution, '2560x1440')
})

test('parsePaste handles inxi (ProtonDB-style: driver, kernel, distro)', () => {
  const inxi = [
    'CPU: 8-core AMD Ryzen 7 7800X3D',
    'GPU: NVIDIA GeForce RTX 4070',
    'Driver: nvidia v: 560.81',
    'Kernel: 6.8.0-45-generic x86_64',
    'Distro: Ubuntu 24.04 LTS',
    'Memory: 31.1 GiB',
  ].join('\n')
  const r = parsePaste(inxi)
  assert.equal(r.osHint, 'Linux')
  assert.ok(r.gpu?.includes('RTX 4070'), `gpu was ${r.gpu}`)
  assert.ok(r.driverVersion?.includes('560'), `driver was ${r.driverVersion}`)
  assert.ok(r.kernel?.includes('6.8.0'), `kernel was ${r.kernel}`)
  assert.ok(r.distro?.includes('Ubuntu'), `distro was ${r.distro}`)
})

test('parsePaste handles macOS system_profiler (Apple M2 Pro)', () => {
  const sp = [
    'Chip: Apple M2 Pro',
    'Memory: 16 GB',
    'Chipset Model: Apple M2 Pro',
    'machdep.cpu.brand_string: Apple M2 Pro',
  ].join('\n')
  const r = parsePaste(sp)
  assert.equal(r.osHint, 'macOS')
  assert.ok(r.cpu?.includes('M2 Pro'), `cpu was ${r.cpu}`)
  assert.ok(r.gpu?.includes('M2 Pro'), `gpu was ${r.gpu}`)
  assert.equal(r.ram, 16)
})

test('parsePaste handles Steam System Information', () => {
  const steam = [
    'Steam System Information',
    'Processor: 12th Gen Intel(R) Core(TM) i7-12700K',
    'Video Card: NVIDIA GeForce RTX 3070 Ti',
    'Memory: 32768 MB',
    'Current Display Mode: 1920x1080 (32 bit) (144Hz)',
  ].join('\n')
  const r = parsePaste(steam)
  assert.ok(r.cpu?.includes('i7-12700K'), `cpu was ${r.cpu}`)
  assert.ok(r.gpu?.includes('RTX 3070 Ti'), `gpu was ${r.gpu}`)
})

// ---------------------------------------------------------------------------
// Accuracy invariants: deviceMemory is a capped hint, cores are not a CPU.
// ---------------------------------------------------------------------------

test('deviceMemoryToHint treats 8 (the spec cap) as a lower-bound, not a precise value', () => {
  const hint = deviceMemoryToHint(8)
  assert.equal(hint.isCapped, true)
  assert.equal(hint.lowerBoundGB, 8)
})

test('deviceMemoryToHint marks sub-cap values as not-capped', () => {
  assert.equal(deviceMemoryToHint(4).isCapped, false)
  assert.equal(deviceMemoryToHint(4).lowerBoundGB, 4)
})

test('hardwareConcurrencyToMeta returns core metadata only, never a CPU model string', () => {
  const meta = hardwareConcurrencyToMeta(16)
  assert.deepEqual(meta, { logicalCores: 16 })
  // Guard against ever re-introducing the fabricated "N-core CPU" string.
  assert.ok(!JSON.stringify(meta).toLowerCase().includes('core cpu'))
  assert.equal(hardwareConcurrencyToMeta(1), undefined)
})

// ---------------------------------------------------------------------------
// cleanCpuString + normalizeDetectedCpu (new for re-do)
// ---------------------------------------------------------------------------

test('cleanCpuString strips core counts, clocks, (R) and Processor noise', () => {
  assert.equal(
    cleanCpuString('AMD Ryzen 7 7800X3D 8-Core Processor (16 CPUs), ~4.0GHz'),
    'AMD Ryzen 7 7800X3D'
  )
  assert.equal(
    cleanCpuString('12th Gen Intel(R) Core(TM) i7-12700K CPU @ 3.60GHz'),
    '12th Gen Intel Core i7-12700K'
  )
})

test('normalizeDetectedCpu cleans then matches catalog canonical', () => {
  const r = normalizeDetectedCpu('AMD Ryzen 7 7800X3D 8-Core Processor (16 CPUs), ~4.0GHz')
  assert.ok(r.canonical?.includes('7800X3D'), `got ${r.canonical}`)
  assert.notEqual(r.method, 'none')
})

// ---------------------------------------------------------------------------
// parseStructuredJson (Windows rundb JSON + Apple -json schema)
// ---------------------------------------------------------------------------

test('parseStructuredJson handles RunDB v2 JSON schema (with vram/refresh/os)', () => {
  const json = JSON.stringify({
    rundb: 1,
    cpu: 'AMD Ryzen 7 7800X3D',
    gpu: 'NVIDIA GeForce RTX 4070 Ti',
    ram: 32,
    resolution: '2560x1440',
    refresh: 144,
    vram: 12,
    os: 'Windows 11 Pro'
  })
  const r = parseStructuredJson(json)
  assert.ok(r, 'should parse')
  assert.equal(r!.cpu?.includes('7800X3D'), true)
  assert.equal(r!.refreshRate, 144)
  assert.equal(r!.vram, 12)
  assert.equal(r!.osVersion, 'Windows 11 Pro')
  assert.equal(r!.osHint, 'Windows')
  assert.equal(r!.method, 'paste')
})

test('parseStructuredJson handles Apple system_profiler -json output', () => {
  const apple = {
    SPHardwareDataType: [{ chip_type: 'Apple M2 Pro', physical_memory: '16 GB' }],
    SPDisplaysDataType: [{ spdisplays_ndrvs: [{ _spdisplays_resolution: '3024 x 1964' }] }]
  }
  const r = parseStructuredJson(JSON.stringify(apple))
  assert.ok(r, 'should parse apple json')
  assert.ok(r!.cpu?.includes('M2 Pro'), `cpu ${r!.cpu}`)
  assert.ok(r!.gpu?.includes('M2 Pro'), `gpu ${r!.gpu}`)
  assert.equal(r!.ram, 16)
  assert.ok(r!.resolution?.includes('3024'))
})

// ---------------------------------------------------------------------------
// mergeDetected precedence (paste wins for models/ram; browser fills res/refresh)
// ---------------------------------------------------------------------------

test('mergeDetected prefers paste for cpu/gpu/ram/vram, browser for resolution/refresh when paste lacks', () => {
  const browser: any = {
    cpu: undefined, gpu: 'NVIDIA GeForce RTX 4060', ram: undefined,
    resolution: '2560x1440', refreshRate: 165, vram: 8,
    confidence: 0.72, method: 'browser', timestamp: 't1', raw: { from: 'webgl' }
  }
  const paste: any = {
    cpu: 'AMD Ryzen 5 7600', gpu: 'NVIDIA GeForce RTX 4070', ram: 32, vram: 12,
    resolution: undefined, refreshRate: undefined,
    confidence: 0.94, method: 'paste', timestamp: 't2', raw: { from: 'inxi' }
  }
  const m = mergeDetected(browser, paste)
  assert.equal(m.cpu, 'AMD Ryzen 5 7600')
  assert.equal(m.gpu, 'NVIDIA GeForce RTX 4070')
  assert.equal(m.ram, 32)
  assert.equal(m.vram, 12)
  assert.equal(m.resolution, '2560x1440') // filled from browser
  assert.equal(m.refreshRate, 165)
  assert.equal(m.method, 'paste')
  assert.ok(m.raw && (m.raw as any).merged === true)
  assert.ok(m.confidence >= 0.9)
})

test('mergeDetected returns paste as-is when no browser', () => {
  const p: any = { cpu: 'x', gpu: 'y', ram: 16, confidence: 0.9, method: 'paste', timestamp: 't', raw: {} }
  assert.deepEqual(mergeDetected(null, p), p)
})
