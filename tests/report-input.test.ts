/**
 * Unit tests for the shared report schema (lib/report-input.ts): the same rules run in the
 * submit/edit dialogs and in the server actions.
 *
 * Run: npx tsx --test tests/report-input.test.ts
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AUTO_REVIEW_FPS_THRESHOLD,
  assessReportPlausibility,
  calculatePerformanceTier,
  containsLink,
  formatReportInputError,
  reportEditFormSchema,
  reportFormSchema,
  submitReportInputSchema,
  updateReportInputSchema,
} from '../lib/report-input'

const GAME = '0b6a5b8e-5d2c-4c1e-9a3f-2d7f1e0c9a11'

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gameId: GAME,
    cpu: 'AMD Ryzen 7 7800X3D',
    gpu: 'NVIDIA GeForce RTX 4070',
    ram: 32,
    resolution: '2560x1440',
    settingsPreset: 'High',
    avgFps: 90,
    ...overrides,
  }
}

function errorOf(schema: typeof submitReportInputSchema | typeof updateReportInputSchema, input: unknown): string {
  const r = schema.safeParse(input)
  assert.equal(r.success, false, 'expected validation to fail')
  return formatReportInputError(r.error!)
}

test('accepts a minimal valid submission and normalizes optional fields', () => {
  const r = submitReportInputSchema.safeParse(valid({ refreshRate: '', fps1PercentLow: null, notes: '   ' }))
  assert.equal(r.success, true)
  assert.equal(r.data!.refreshRate, undefined)
  assert.equal(r.data!.fps1PercentLow, undefined)
  assert.equal(r.data!.notes, undefined)
  assert.equal(r.data!.ram, 32)
})

test('accepts numeric strings from form inputs', () => {
  const r = submitReportInputSchema.safeParse(valid({ ram: '16', avgFps: '72.5', refreshRate: '144', fps1PercentLow: '50' }))
  assert.equal(r.success, true)
  assert.deepEqual([r.data!.ram, r.data!.avgFps, r.data!.refreshRate, r.data!.fps1PercentLow], [16, 72.5, 144, 50])
})

test('accepts the detection metadata the client forwards (kernel, distro, canonical names)', () => {
  const r = submitReportInputSchema.safeParse(
    valid({ kernel: '6.8.0', distro: 'Arch', canonicalCpu: 'Ryzen 7 7800X3D', canonicalGpu: 'RTX 4070' }),
  )
  assert.equal(r.success, true)
})

test('rejects unknown keys (tampered status / user_id / vote counters)', () => {
  for (const extra of [{ status: 'approved' }, { userId: 'x' }, { user_id: 'x' }, { helpfulVotes: 999 }, { performanceTier: 'Excellent' }]) {
    assert.match(errorOf(submitReportInputSchema, valid(extra)), /fields that cannot be set/)
  }
  const { gameId: _g, ...edit } = valid()
  assert.match(errorOf(updateReportInputSchema, { ...edit, status: 'approved' }), /fields that cannot be set/)
  // gameId is not editable
  assert.match(errorOf(updateReportInputSchema, valid()), /fields that cannot be set/)
})

test('rejects wrong types instead of coercing them', () => {
  assert.match(errorOf(submitReportInputSchema, valid({ avgFps: true })), /Average FPS must be a number/)
  assert.match(errorOf(submitReportInputSchema, valid({ avgFps: [60] })), /Average FPS must be a number/)
  assert.match(errorOf(submitReportInputSchema, valid({ avgFps: '60fps' })), /Average FPS must be a number/)
  assert.match(errorOf(submitReportInputSchema, valid({ cpu: { name: 'x' } })), /CPU/)
  assert.match(errorOf(submitReportInputSchema, valid({ notes: 42 })), /Notes must be text/)
})

test('enforces numeric ranges at the edges', () => {
  assert.equal(submitReportInputSchema.safeParse(valid({ avgFps: 1 })).success, true)
  assert.equal(submitReportInputSchema.safeParse(valid({ avgFps: 600 })).success, true)
  assert.match(errorOf(submitReportInputSchema, valid({ avgFps: 0.5 })), /at least 1/)
  assert.match(errorOf(submitReportInputSchema, valid({ avgFps: 601 })), /at most 600/)
  assert.match(errorOf(submitReportInputSchema, valid({ avgFps: Infinity })), /Average FPS/)
  assert.equal(submitReportInputSchema.safeParse(valid({ ram: 2 })).success, true)
  assert.equal(submitReportInputSchema.safeParse(valid({ ram: 256 })).success, true)
  assert.match(errorOf(submitReportInputSchema, valid({ ram: 1 })), /RAM/)
  assert.match(errorOf(submitReportInputSchema, valid({ ram: 512 })), /RAM/)
  assert.match(errorOf(submitReportInputSchema, valid({ ram: 15.5 })), /whole number/)
  assert.match(errorOf(submitReportInputSchema, valid({ refreshRate: 29 })), /Refresh rate/)
  assert.match(errorOf(submitReportInputSchema, valid({ refreshRate: 1001 })), /Refresh rate/)
  assert.match(errorOf(submitReportInputSchema, valid({ fps1PercentLow: 0 })), /1% low FPS must be greater than 0/)
})

test('1% low cannot exceed the average', () => {
  assert.equal(submitReportInputSchema.safeParse(valid({ avgFps: 90, fps1PercentLow: 90 })).success, true)
  assert.match(errorOf(submitReportInputSchema, valid({ avgFps: 90, fps1PercentLow: 120 })), /cannot be higher than average/)
  assert.equal(reportEditFormSchema.safeParse({ ...valid({ avgFps: 60, fps1PercentLow: 61 }), gameId: undefined }).success, false)
})

test('resolution must be WIDTHxHEIGHT in a sane range', () => {
  for (const ok of ['1280x720', '3440x1440', '7680x4320', ' 1920x1080 ']) {
    assert.equal(submitReportInputSchema.safeParse(valid({ resolution: ok })).success, true, ok)
  }
  assert.match(errorOf(submitReportInputSchema, valid({ resolution: '1080p' })), /like 1920x1080/)
  assert.match(errorOf(submitReportInputSchema, valid({ resolution: '<script>' })), /like 1920x1080/)
  assert.match(errorOf(submitReportInputSchema, valid({ resolution: '99999x99999' })), /outside the supported range/)
})

test('graphics preset must be one of the enum values', () => {
  assert.match(errorOf(submitReportInputSchema, valid({ settingsPreset: 'Epic' })), /graphics preset/)
})

test('custom settings notes are dropped unless the preset is Custom', () => {
  const high = submitReportInputSchema.parse(valid({ settingsPreset: 'High', customSettingsNotes: 'RT on' }))
  assert.equal(high.customSettingsNotes, undefined)
  const custom = submitReportInputSchema.parse(valid({ settingsPreset: 'Custom', customSettingsNotes: 'RT on' }))
  assert.equal(custom.customSettingsNotes, 'RT on')
})

test('string length caps and sanitizing', () => {
  assert.match(errorOf(submitReportInputSchema, valid({ cpu: 'x'.repeat(81) })), /CPU name is too long/)
  assert.match(errorOf(submitReportInputSchema, valid({ notes: 'x'.repeat(501) })), /Notes is too long/)
  assert.match(errorOf(submitReportInputSchema, valid({ driverVersion: '1'.repeat(41) })), /Driver version is too long/)
  assert.match(errorOf(submitReportInputSchema, valid({ cpu: '<>' })), /CPU is required/)
  // Long notes are no longer cut at 80 characters by the sanitizer.
  const long = 'Smooth after the latest patch '.repeat(10).trim()
  assert.equal(submitReportInputSchema.parse(valid({ notes: long })).notes, long)
  // Markup characters are stripped; normal punctuation is kept.
  assert.equal(submitReportInputSchema.parse(valid({ notes: 'ok <b>bold</b>' })).notes, 'ok bbold/b')
  assert.equal(
    submitReportInputSchema.parse(valid({ tweaks: 'DLSS: Quality, FG on (60%) + RT/PT off!' })).tweaks,
    'DLSS: Quality, FG on (60%) + RT/PT off!',
  )
})

test('server requires a UUID game id; the client form accepts mock slugs', () => {
  assert.match(errorOf(submitReportInputSchema, valid({ gameId: 'elden-ring' })), /Game not found/)
  assert.equal(reportFormSchema.safeParse(valid({ gameId: 'elden-ring' })).success, true)
})

test('tier calculation boundaries', () => {
  assert.deepEqual(
    [24.9, 25, 40, 60, 90].map(calculatePerformanceTier),
    ['Unplayable', 'Struggling', 'Playable', 'Good', 'Excellent'],
  )
})

test('link detection catches protocols, www and bare domains but not version numbers', () => {
  for (const s of ['see https://x.y', 'www.cheap-keys', 'buy at cheapkeys.com now', 'discord.gg/abc']) {
    assert.equal(containsLink(s), true, s)
  }
  for (const s of ['Ryzen 7 7800X3D', 'driver 551.86', 'DLSS 3.5 quality', 'v1.0.2']) {
    assert.equal(containsLink(s), false, s)
  }
})

test('plausibility: catalog hardware with normal FPS publishes; outliers are held with reasons', () => {
  const ok = submitReportInputSchema.parse(valid())
  assert.deepEqual(assessReportPlausibility(ok, valid()), [])

  const unknownHw = submitReportInputSchema.parse(valid({ cpu: 'Zzqx Quantum 9000', gpu: 'Qwfp Hyper 1' }))
  assert.deepEqual(assessReportPlausibility(unknownHw, valid()), ['CPU not in hardware catalog', 'GPU not in hardware catalog'])

  const fast = submitReportInputSchema.parse(valid({ avgFps: AUTO_REVIEW_FPS_THRESHOLD + 1 }))
  assert.deepEqual(assessReportPlausibility(fast, valid()), [`average FPS above ${AUTO_REVIEW_FPS_THRESHOLD}`])
  const edge = submitReportInputSchema.parse(valid({ avgFps: AUTO_REVIEW_FPS_THRESHOLD }))
  assert.deepEqual(assessReportPlausibility(edge, valid()), [])

  // Raw payload is checked because sanitizing strips the protocol.
  const raw = valid({ notes: 'great deals at https://spam.example' })
  const parsed = submitReportInputSchema.parse(raw)
  assert.deepEqual(assessReportPlausibility(parsed, raw), ['link in text fields'])
})
