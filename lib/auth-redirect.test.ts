import assert from 'node:assert/strict'
import test from 'node:test'
import { getSafeAuthRedirectPath } from './auth-redirect'

test('getSafeAuthRedirectPath keeps same-origin relative paths', () => {
  assert.equal(getSafeAuthRedirectPath('/games/42'), '/games/42')
  assert.equal(getSafeAuthRedirectPath('/games/42?tab=reports#latest'), '/games/42?tab=reports#latest')
})

test('getSafeAuthRedirectPath falls back for missing or non-path values', () => {
  assert.equal(getSafeAuthRedirectPath(null), '/')
  assert.equal(getSafeAuthRedirectPath(undefined), '/')
  assert.equal(getSafeAuthRedirectPath(''), '/')
  assert.equal(getSafeAuthRedirectPath('dashboard'), '/')
  assert.equal(getSafeAuthRedirectPath('@evil.example/phish'), '/')
  assert.equal(getSafeAuthRedirectPath('https://evil.example/phish'), '/')
  assert.equal(getSafeAuthRedirectPath('javascript:alert(1)'), '/')
})

test('getSafeAuthRedirectPath rejects protocol-relative and ambiguous paths', () => {
  assert.equal(getSafeAuthRedirectPath('//evil.example/phish'), '/')
  assert.equal(getSafeAuthRedirectPath('/\\evil.example/phish'), '/')
  assert.equal(getSafeAuthRedirectPath('/games\nLocation: https://evil.example'), '/')
})
