import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addMonthUtc,
  downgradeCreditMinor,
  graceUntil,
  prorationMinor,
  quoteAddedSeats,
  quoteSubscription,
  remainingFraction,
  roundMinor,
} from './pricing.ts'

const PLAN = { displayName: 'Growth', pricePerSeatMinor: 89900 }

const at = (iso: string) => new Date(iso)

// --- the billing month ------------------------------------------------------

test('a month on is the same day of the next month', () => {
  assert.equal(
    addMonthUtc(at('2026-09-22T09:00:00.000Z')).toISOString(),
    '2026-10-22T09:00:00.000Z',
  )
})

test('the 31st does not roll into the month after next', () => {
  // The bug this exists to prevent: 31 January + 1 month must not be 3 March.
  assert.equal(
    addMonthUtc(at('2027-01-31T00:00:00.000Z')).toISOString(),
    '2027-02-28T00:00:00.000Z',
  )
})

test('a leap February is used when there is one', () => {
  assert.equal(
    addMonthUtc(at('2028-01-31T00:00:00.000Z')).toISOString(),
    '2028-02-29T00:00:00.000Z',
  )
})

test('December rolls into January of the next year', () => {
  assert.equal(
    addMonthUtc(at('2026-12-15T12:30:00.000Z')).toISOString(),
    '2027-01-15T12:30:00.000Z',
  )
})

test('grace is three days past the due date', () => {
  assert.equal(
    graceUntil(at('2026-09-22T00:00:00.000Z')).toISOString(),
    '2026-09-25T00:00:00.000Z',
  )
})

// --- rounding ---------------------------------------------------------------

test('money rounds half away from zero, in both directions', () => {
  assert.equal(roundMinor(10.5), 11)
  assert.equal(roundMinor(-10.5), -11)
  assert.equal(roundMinor(10.4), 10)
  assert.equal(roundMinor(-10.4), -10)
})

// --- the fraction of a cycle left -------------------------------------------

test('half way through a cycle is half a cycle', () => {
  const fraction = remainingFraction(
    at('2026-09-01T00:00:00.000Z'),
    at('2026-09-03T00:00:00.000Z'),
    at('2026-09-02T00:00:00.000Z'),
  )
  assert.equal(fraction, 0.5)
})

test('a moment before the cycle starts is still a whole cycle, not more', () => {
  const fraction = remainingFraction(
    at('2026-09-01T00:00:00.000Z'),
    at('2026-10-01T00:00:00.000Z'),
    at('2026-08-01T00:00:00.000Z'),
  )
  assert.equal(fraction, 1)
})

test('after the cycle has ended nothing is left', () => {
  const fraction = remainingFraction(
    at('2026-09-01T00:00:00.000Z'),
    at('2026-10-01T00:00:00.000Z'),
    at('2026-11-01T00:00:00.000Z'),
  )
  assert.equal(fraction, 0)
})

test('a period with no length cannot be divided', () => {
  const instant = at('2026-09-01T00:00:00.000Z')
  assert.equal(remainingFraction(instant, instant, instant), 0)
})

// --- pro-ration -------------------------------------------------------------

test('a seat added half way through costs half', () => {
  assert.equal(
    prorationMinor(
      PLAN.pricePerSeatMinor,
      at('2026-09-01T00:00:00.000Z'),
      at('2026-09-03T00:00:00.000Z'),
      at('2026-09-02T00:00:00.000Z'),
    ),
    44950,
  )
})

test('pro-ration is never more than a full seat, whatever the clock says', () => {
  const amount = prorationMinor(
    PLAN.pricePerSeatMinor,
    at('2026-09-01T00:00:00.000Z'),
    at('2026-10-01T00:00:00.000Z'),
    at('2020-01-01T00:00:00.000Z'),
  )
  assert.equal(amount, PLAN.pricePerSeatMinor)
})

test('pro-ration is never negative', () => {
  const amount = prorationMinor(
    PLAN.pricePerSeatMinor,
    at('2026-09-01T00:00:00.000Z'),
    at('2026-10-01T00:00:00.000Z'),
    at('2030-01-01T00:00:00.000Z'),
  )
  assert.equal(amount, 0)
})

// --- downgrade credit (Section 13 Q5) ---------------------------------------

test('a downgrade half way through credits half the difference per seat', () => {
  const credit = downgradeCreditMinor({
    fromPricePerSeatMinor: 89900,
    toPricePerSeatMinor: 49900,
    seats: 2,
    periodStart: at('2026-09-01T00:00:00.000Z'),
    periodEnd: at('2026-09-03T00:00:00.000Z'),
    at: at('2026-09-02T00:00:00.000Z'),
  })
  assert.equal(credit, 40000)
})

test('an upgrade produces no credit — it is charged as a pro-ration instead', () => {
  const credit = downgradeCreditMinor({
    fromPricePerSeatMinor: 49900,
    toPricePerSeatMinor: 89900,
    seats: 2,
    periodStart: at('2026-09-01T00:00:00.000Z'),
    periodEnd: at('2026-10-01T00:00:00.000Z'),
    at: at('2026-09-15T00:00:00.000Z'),
  })
  assert.equal(credit, 0)
})

test('a downgrade on the last day credits nothing worth having', () => {
  const credit = downgradeCreditMinor({
    fromPricePerSeatMinor: 89900,
    toPricePerSeatMinor: 49900,
    seats: 3,
    periodStart: at('2026-09-01T00:00:00.000Z'),
    periodEnd: at('2026-10-01T00:00:00.000Z'),
    at: at('2026-10-01T00:00:00.000Z'),
  })
  assert.equal(credit, 0)
})

// --- a cycle's invoice ------------------------------------------------------

test('the total is the per-seat price times the seats', () => {
  const quote = quoteSubscription({
    plan: PLAN,
    seats: 3,
    periodStart: at('2026-09-22T00:00:00.000Z'),
  })

  assert.equal(quote.subtotalMinor, 269700)
  assert.equal(quote.totalMinor, 269700)
  assert.equal(quote.periodEnd, '2026-10-22T00:00:00.000Z')
  assert.equal(quote.lines.length, 1)
  assert.equal(quote.lines[0].quantity, 3)
})

test('tax is charged on the sale, and credit comes off afterwards', () => {
  const quote = quoteSubscription({
    plan: PLAN,
    seats: 1,
    taxRatePercent: 15,
    creditAvailableMinor: 10000,
    periodStart: at('2026-09-22T00:00:00.000Z'),
  })

  assert.equal(quote.subtotalMinor, 89900)
  assert.equal(quote.taxMinor, 13485)
  assert.equal(quote.creditAppliedMinor, 10000)
  // Credit applied before tax would have made the tax smaller on a sale that
  // did happen — the point of the ordering.
  assert.equal(quote.totalMinor, 89900 + 13485 - 10000)
})

test('credit never takes an invoice below zero', () => {
  const quote = quoteSubscription({
    plan: PLAN,
    seats: 1,
    creditAvailableMinor: 500000,
    periodStart: at('2026-09-22T00:00:00.000Z'),
  })

  assert.equal(quote.totalMinor, 0)
  assert.equal(quote.creditAppliedMinor, 89900)
})

test('zero seats is a zero invoice, not a negative one', () => {
  const quote = quoteSubscription({
    plan: PLAN,
    seats: 0,
    periodStart: at('2026-09-22T00:00:00.000Z'),
  })
  assert.equal(quote.totalMinor, 0)
})

test('a fractional seat count cannot be smuggled in', () => {
  const quote = quoteSubscription({
    plan: PLAN,
    seats: 2.9,
    periodStart: at('2026-09-22T00:00:00.000Z'),
  })
  assert.equal(quote.lines[0].quantity, 2)
  assert.equal(quote.subtotalMinor, 179800)
})

// --- mid-cycle seats --------------------------------------------------------

test('added seats are billed only to the end of the current cycle', () => {
  const quote = quoteAddedSeats({
    plan: PLAN,
    seats: 2,
    periodStart: at('2026-09-01T00:00:00.000Z'),
    periodEnd: at('2026-09-03T00:00:00.000Z'),
    at: at('2026-09-02T00:00:00.000Z'),
  })

  assert.equal(quote.totalMinor, 89900)
  assert.equal(quote.periodEnd, '2026-09-03T00:00:00.000Z')
  assert.equal(quote.lines[0].kind, 'proration')
})
