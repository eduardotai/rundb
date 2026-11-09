import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeReportText } from './sanitize'

test('sanitizeReportText keeps the punctuation people use in tweaks and notes', () => {
  for (const s of [
    'DLSS: Quality, Frame Gen on (60%)',
    'RT/PT off; shadows medium + textures ultra!',
    'Driver 560.81 - fixed stutter @ 1440p? yes & no #1',
    'Avg 95 fps = smooth, 1% low ~70 * with "Ultra" preset',
    'Baldur\'s Gate 3 – act 3 city ~ 55 fps',
  ]) {
    assert.equal(sanitizeReportText(s, 500), s)
  }
})

test('sanitizeReportText removes markup delimiters and script-capable schemes', () => {
  assert.equal(sanitizeReportText('<script>alert(1)</script>', 500), 'scriptalert(1)/script')
  assert.equal(sanitizeReportText('<img src=x onerror=alert(1)>', 500), 'img src=x onerror=alert(1)')
  assert.equal(sanitizeReportText('click javascript:alert(1)', 500), 'click alert(1)')
  assert.equal(sanitizeReportText('JaVaScRiPt :alert(1)', 500), 'alert(1)')
  assert.equal(sanitizeReportText('javajavascript:script:alert(1)', 500), 'alert(1)')
  assert.equal(sanitizeReportText('data:text/html;base64,PHN', 500), 'text/html;base64,PHN')
  assert.equal(sanitizeReportText('vbscript:msgbox', 500), 'msgbox')
  assert.equal(sanitizeReportText('`template`', 500), 'template')
  // Prose that merely contains "data:" followed by a space is left alone.
  assert.equal(sanitizeReportText('telemetry data: off', 500), 'telemetry data: off')
})

test('sanitizeReportText strips control and invisible format characters', () => {
  assert.equal(sanitizeReportText('a\u0000b\u0007c', 500), 'a b c')
  assert.equal(sanitizeReportText('safe\u202Etxt.exe', 500), 'safe txt.exe') // RTL override
  assert.equal(sanitizeReportText('zero\u200Bwidth', 500), 'zero width')
  assert.equal(sanitizeReportText('  many   spaces\n\nand\tlines  ', 500), 'many spaces and lines')
})

test('sanitizeReportText caps length', () => {
  assert.equal(sanitizeReportText('x'.repeat(600), 500).length, 500)
  assert.equal(sanitizeReportText('abc def', 4), 'abc')
})
