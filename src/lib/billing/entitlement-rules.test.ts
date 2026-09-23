import test from 'node:test'
import assert from 'node:assert/strict'
import { decideEntitlement, subscriptionCovers } from './entitlement-rules.ts'
import type { CoverageRow, SeatRow } from './entitlement-rules.ts'

/**
 * Section 4's second gate, and the one rule it must never break: when it
 * cannot tell, it refuses.
 *
 * The first two tests below are regressions. Both were live defects, both
 * returned `allowed: true` for a post that must not go out, and neither was
 * catchable before the rules were split out of the module that imports
 * `server-only`.
 */

const LIVE: CoverageRow = {
  status: 'active',
  grace_until: null,
  current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
}

const seat = (over: Partial<SeatRow> = {}): SeatRow => ({
  id: 'acct-1',
  display_name: 'Demo Page',
  external_username: null,
  status: 'active',
  paid_seat: true,
  ...over,
})

const base = {
  isBillingExempt: false,
  coverage: LIVE,
  requestedIds: ['acct-1'],
  accounts: [seat()],
  readable: true,
  now: new Date(),
}

test('an unreadable account list refuses rather than allowing', () => {
  // The defect: a failed query produced an empty list, which is indistinguishable
  // from "none of these accounts is a problem" unless the two are kept apart.
  const result = decideEntitlement({ ...base, accounts: [], readable: false })
  assert.equal(result.allowed, false, 'the gate must fail closed')
})

test('an account the workspace cannot see is refused, not ignored', () => {
  // Being told about one of two accounts is not permission to publish to both.
  const result = decideEntitlement({
    ...base,
    requestedIds: ['acct-1', 'acct-elsewhere'],
    accounts: [seat()],
  })
  assert.equal(result.allowed, false)
  if (!result.allowed && 'accountIds' in result.block) {
    assert.deepEqual(result.block.accountIds, ['acct-elsewhere'])
  }
})

test('an active, paid account may publish', () => {
  assert.equal(decideEntitlement(base).allowed, true)
})

test('no subscription means no publishing', () => {
  const result = decideEntitlement({ ...base, coverage: null })
  assert.equal(result.allowed, false)
  if (!result.allowed) assert.equal(result.block.reason, 'no_subscription')
})

test('an unpaid seat holds drafts only', () => {
  const result = decideEntitlement({ ...base, accounts: [seat({ paid_seat: false })] })
  assert.equal(result.allowed, false)
  if (!result.allowed) assert.equal(result.block.reason, 'accounts_unpaid')
})

test('an account needing reconnection cannot publish', () => {
  const result = decideEntitlement({
    ...base,
    accounts: [seat({ status: 'needs_reconnect' })],
  })
  assert.equal(result.allowed, false)
  if (!result.allowed) assert.equal(result.block.reason, 'accounts_inactive')
})

test('an exempt workspace publishes whatever the seats say', () => {
  const result = decideEntitlement({
    ...base,
    isBillingExempt: true,
    coverage: null,
    accounts: [],
    readable: false,
  })
  assert.equal(result.allowed, true)
})

test('asking with no targets only asks about the subscription', () => {
  // The composer's question before any account is chosen.
  const result = decideEntitlement({ ...base, requestedIds: [], accounts: [], readable: false })
  assert.equal(result.allowed, true)
})

test('grace keeps publishing alive; its expiry does not', () => {
  const inGrace: CoverageRow = {
    status: 'past_due',
    grace_until: new Date(Date.now() + 3_600_000).toISOString(),
    current_period_end: new Date(Date.now() - 86_400_000).toISOString(),
  }
  assert.equal(subscriptionCovers(inGrace, new Date()), true)

  const lapsed: CoverageRow = {
    ...inGrace,
    grace_until: new Date(Date.now() - 3_600_000).toISOString(),
  }
  assert.equal(subscriptionCovers(lapsed, new Date()), false)
})

test('a cancelled subscription covers nothing, grace or not', () => {
  const cancelled: CoverageRow = {
    status: 'cancelled',
    grace_until: new Date(Date.now() + 86_400_000).toISOString(),
    current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
  }
  assert.equal(subscriptionCovers(cancelled, new Date()), false)
})
