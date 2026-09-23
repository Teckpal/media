import test from 'node:test'
import assert from 'node:assert/strict'
import {
  countsAsActivity,
  IDLE_LIMIT_MS,
  isAuthCookie,
  readActivity,
} from './idle.ts'

const NOW = 1_800_000_000_000

const headers = (entries: Record<string, string>) => ({
  get: (name: string) => entries[name.toLowerCase()] ?? null,
})

test('a recent stamp is fresh', () => {
  assert.equal(readActivity(String(NOW - 60_000), NOW), 'fresh')
})

test('a stamp older than the limit is expired', () => {
  assert.equal(readActivity(String(NOW - IDLE_LIMIT_MS - 1), NOW), 'expired')
})

test('the boundary itself is still fresh', () => {
  // Exactly thirty minutes is within the window; a second more is not.
  assert.equal(readActivity(String(NOW - IDLE_LIMIT_MS), NOW), 'fresh')
})

test('a missing stamp is unknown, not expired', () => {
  // A first request must not sign anybody out.
  assert.equal(readActivity(undefined, NOW), 'unknown')
  assert.equal(readActivity('', NOW), 'unknown')
})

test('a nonsense stamp is unknown rather than trusted', () => {
  assert.equal(readActivity('tomorrow', NOW), 'unknown')
  assert.equal(readActivity('-1', NOW), 'unknown')
  assert.equal(readActivity('NaN', NOW), 'unknown')
})

test('a stamp from the future is not trusted', () => {
  // Otherwise a forged far-future value would keep a session alive for ever.
  assert.equal(readActivity(String(NOW + 86_400_000), NOW), 'unknown')
})

test('a small clock skew into the future is tolerated', () => {
  assert.equal(readActivity(String(NOW + 5_000), NOW), 'fresh')
})

test('an ordinary navigation counts as activity', () => {
  assert.equal(countsAsActivity(headers({})), true)
})

test('a prefetch does not count as activity', () => {
  // A cursor drifting over a nav bar must not keep an unattended screen alive.
  assert.equal(countsAsActivity(headers({ 'next-router-prefetch': '1' })), false)
  assert.equal(countsAsActivity(headers({ purpose: 'prefetch' })), false)
})

test('supabase auth cookies are recognised however they are chunked', () => {
  assert.equal(isAuthCookie('sb-koiimpnvaxadigwiuhbk-auth-token'), true)
  assert.equal(isAuthCookie('sb-koiimpnvaxadigwiuhbk-auth-token.0'), true)
  assert.equal(isAuthCookie('sb-koiimpnvaxadigwiuhbk-auth-token-code-verifier'), true)
  assert.equal(isAuthCookie('motif_seen'), false)
  assert.equal(isAuthCookie('motif_region'), false)
})
