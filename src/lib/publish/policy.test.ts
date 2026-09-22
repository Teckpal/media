import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backoffMs, decideAfterFailure, explainGivingUp } from './policy.ts'
import { MAX_PUBLISH_ATTEMPTS } from '../constants.ts'

const NOW = new Date('2026-09-22T09:00:00.000Z')

function decide(facts: Partial<Parameters<typeof decideAfterFailure>[0]>) {
  return decideAfterFailure(
    { attempts: 1, retryable: true, safeToRepeat: true, ...facts },
    NOW,
  )
}

// --- backoff ----------------------------------------------------------------

test('backoff grows with each attempt', () => {
  assert.equal(backoffMs(1), 60_000)
  assert.equal(backoffMs(2), 180_000)
  assert.equal(backoffMs(3), 540_000)
})

test('backoff is capped, so a stubborn target does not drift out to hours', () => {
  assert.equal(backoffMs(9), 15 * 60_000)
  assert.equal(backoffMs(99), 15 * 60_000)
})

test('a nonsensical attempt count still yields a usable delay', () => {
  assert.equal(backoffMs(0), 60_000)
  assert.equal(backoffMs(-4), 60_000)
})

// --- the decision -----------------------------------------------------------

test('a retryable failure with attempts left is scheduled, not failed', () => {
  const outcome = decide({ attempts: 1 })
  assert.equal(outcome.kind, 'retry')
  assert.equal(
    outcome.kind === 'retry' ? outcome.nextAttemptAt.toISOString() : null,
    '2026-09-22T09:01:00.000Z',
  )
})

test('a permanent failure is not retried, however many attempts remain', () => {
  const outcome = decide({ attempts: 1, retryable: false })
  assert.deepEqual(outcome, { kind: 'fail', because: 'permanent' })
})

test('the last attempt fails rather than scheduling a fourth', () => {
  const outcome = decide({ attempts: MAX_PUBLISH_ATTEMPTS })
  assert.deepEqual(outcome, { kind: 'fail', because: 'exhausted' })
})

test('an attempt count past the limit still fails cleanly', () => {
  const outcome = decide({ attempts: MAX_PUBLISH_ATTEMPTS + 5 })
  assert.deepEqual(outcome, { kind: 'fail', because: 'exhausted' })
})

/**
 * The one that matters most: Section 6.2 would rather a post did not go out
 * than go out twice.
 */
test('an unconfirmed send stops, even though it was retryable and has attempts left', () => {
  const outcome = decide({ attempts: 1, retryable: true, safeToRepeat: false })
  assert.deepEqual(outcome, { kind: 'fail', because: 'unconfirmed' })
})

test('permanence is decided before the attempt count', () => {
  const outcome = decide({ attempts: 1, retryable: false, safeToRepeat: false })
  assert.equal(outcome.kind === 'fail' && outcome.because, 'permanent')
})

test('a custom limit is honoured', () => {
  assert.equal(decide({ attempts: 1, maxAttempts: 1 }).kind, 'fail')
  assert.equal(decide({ attempts: 1, maxAttempts: 2 }).kind, 'retry')
})

// --- what the user reads ----------------------------------------------------

test('an unconfirmed failure never claims the post failed', () => {
  const text = explainGivingUp('unconfirmed', 'Facebook stopped responding.')
  assert.match(text, /could not confirm/i)
  assert.match(text, /twice/i)
})

test('a permanent failure is reported as the platform put it, unadorned', () => {
  assert.equal(
    explainGivingUp('permanent', 'That caption was rejected.'),
    'That caption was rejected.',
  )
})

test('an exhausted failure says how hard we tried', () => {
  assert.match(explainGivingUp('exhausted', 'Facebook is down.'), /3 times/)
})
