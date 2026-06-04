import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeFullName } from './sanitize'
import { normalizeHardwareSync } from './normalize-hardware'

test('sanitizeFullName preserves hardware model numbers and safe punctuation', () => {
  assert.equal(sanitizeFullName('NVIDIA GeForce RTX 4090'), 'NVIDIA GeForce RTX 4090')
  assert.equal(sanitizeFullName('AMD Ryzen 7 7800X3D'), 'AMD Ryzen 7 7800X3D')
  assert.equal(sanitizeFullName('Driver 560.81'), 'Driver 560.81')
})

test('sanitized catalog hardware still normalizes to known entries', () => {
  const gpu = normalizeHardwareSync(sanitizeFullName('NVIDIA GeForce RTX 4090'))
  const cpu = normalizeHardwareSync(sanitizeFullName('AMD Ryzen 7 7800X3D'))

  assert.equal(gpu.canonical, 'NVIDIA GeForce RTX 4090')
  assert.equal(cpu.canonical, 'AMD Ryzen 7 7800X3D')
})
