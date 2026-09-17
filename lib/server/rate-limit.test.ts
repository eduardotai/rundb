import assert from 'node:assert/strict'
import test from 'node:test'
import { clientIpFromHeaders, createRateLimiter } from './rate-limit'

test('createRateLimiter allows up to limit hits per window then blocks', () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000 })
  const t0 = 10_000
  assert.equal(limiter.check('a', t0).ok, true)
  assert.equal(limiter.check('a', t0 + 10).ok, true)
  const third = limiter.check('a', t0 + 20)
  assert.equal(third.ok, true)
  assert.equal(third.remaining, 0)
  const blocked = limiter.check('a', t0 + 30)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.retryAfterMs, 970)
  // Different key is independent.
  assert.equal(limiter.check('b', t0 + 30).ok, true)
})

test('createRateLimiter resets after the window elapses', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 500 })
  assert.equal(limiter.check('k', 0).ok, true)
  assert.equal(limiter.check('k', 499).ok, false)
  assert.equal(limiter.check('k', 500).ok, true)
})

test('clientIpFromHeaders prefers first x-forwarded-for hop, falls back to x-real-ip / unknown', () => {
  const h = (map: Record<string, string>) => ({ get: (n: string) => map[n.toLowerCase()] ?? null })
  assert.equal(clientIpFromHeaders(h({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '203.0.113.9')
  assert.equal(clientIpFromHeaders(h({ 'x-real-ip': '198.51.100.2' })), '198.51.100.2')
  assert.equal(clientIpFromHeaders(h({})), 'unknown')
})
