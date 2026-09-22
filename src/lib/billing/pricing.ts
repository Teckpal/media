// Pure, and imported with relative paths so the test runner can load it
// directly. No database, no gateway, no clock of its own — every function here
// takes the time it should use.
import { PAYMENT_GRACE_DAYS } from '../constants.ts'

/**
 * Section 7.1: "priced per connected social account, per month", and Section
 * 7A.3: "the server reads the price from the DB by region + package. Never
 * trust a price sent from the browser."
 *
 * This module does the arithmetic and nothing else. The price it works from is
 * always passed in, having been read from `plans` by the caller — so there is
 * no path by which a number from a form reaches a total.
 *
 * Everything is integer minor units: poisha for BDT, cents for USD. No float
 * ever touches money; `0.1 + 0.2` is a bug waiting for an invoice.
 */

export type QuoteLine = {
  kind: 'seat' | 'proration' | 'ai_topup' | 'credit' | 'tax' | 'adjustment'
  description: string
  quantity: number
  unitAmountMinor: number
  amountMinor: number
  socialAccountId?: string | null
}

export type Quote = {
  lines: QuoteLine[]
  subtotalMinor: number
  taxMinor: number
  creditAppliedMinor: number
  totalMinor: number
  periodStart: string
  periodEnd: string
}

/**
 * One month on, clamped to the end of a shorter month.
 *
 * The 31st of January plus a month is the 28th of February, not the 3rd of
 * March — a customer billed on the 31st should not drift forward through the
 * year, and JavaScript's own date arithmetic rolls over silently.
 */
export function addMonthUtc(from: Date): Date {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth()
  const day = from.getUTCDate()

  const lastDayOfNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate()

  return new Date(
    Date.UTC(
      year,
      month + 1,
      Math.min(day, lastDayOfNextMonth),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  )
}

/** Section 7.2: three days past the due date before publishing locks. */
export function graceUntil(dueAt: Date): Date {
  return new Date(dueAt.getTime() + PAYMENT_GRACE_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * The share of a cycle that is still to come, as a fraction from 0 to 1.
 *
 * Used for both directions of a mid-cycle change: what an added seat costs,
 * and what a downgrade gives back.
 */
export function remainingFraction(
  periodStart: Date,
  periodEnd: Date,
  at: Date,
): number {
  const total = periodEnd.getTime() - periodStart.getTime()
  if (total <= 0) return 0

  const left = periodEnd.getTime() - at.getTime()
  if (left <= 0) return 0
  if (left >= total) return 1

  return left / total
}

/**
 * Rounds money to whole minor units.
 *
 * Half away from zero, so a half-poisha does not sometimes round down for the
 * customer and sometimes for us depending on whether the integer beside it
 * happens to be even — which is what `Math.round` on negatives would do.
 */
export function roundMinor(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/**
 * What a seat added part-way through a cycle costs (Section 7.2, pro-ration).
 *
 * Never more than a full seat and never less than nothing, whatever the clock
 * says — a server whose time has slipped should not be able to invent a
 * negative charge.
 */
export function prorationMinor(
  pricePerSeatMinor: number,
  periodStart: Date,
  periodEnd: Date,
  at: Date,
): number {
  const fraction = remainingFraction(periodStart, periodEnd, at)
  const amount = roundMinor(pricePerSeatMinor * fraction)
  return Math.min(Math.max(amount, 0), pricePerSeatMinor)
}

/**
 * Section 13 Q5: a downgrade becomes credit on the next invoice, never a cash
 * refund.
 *
 * The credit is the unused part of the difference between what was paid for
 * and what is now in use. An upgrade returns 0 — the extra is charged as a
 * pro-ration instead, and one change must never produce both.
 */
export function downgradeCreditMinor(params: {
  fromPricePerSeatMinor: number
  toPricePerSeatMinor: number
  seats: number
  periodStart: Date
  periodEnd: Date
  at: Date
}): number {
  const difference = params.fromPricePerSeatMinor - params.toPricePerSeatMinor
  if (difference <= 0 || params.seats <= 0) return 0

  const fraction = remainingFraction(params.periodStart, params.periodEnd, params.at)
  return Math.max(0, roundMinor(difference * params.seats * fraction))
}

export type QuoteInput = {
  plan: { displayName: string; pricePerSeatMinor: number }
  seats: number
  /** Unused credit from an earlier downgrade, in the same currency. */
  creditAvailableMinor?: number
  /**
   * Section 7.2: BD VAT is still with the accountant. The rate is an input so
   * applying it later is a configuration change, not a rewrite.
   */
  taxRatePercent?: number
  periodStart: Date
  periodEnd?: Date
}

/**
 * A full cycle's invoice: seats, tax, then credit.
 *
 * Order matters. Tax is calculated on what is actually being sold, and credit
 * comes off the gross — applying credit first would quietly reduce the tax due
 * on a sale that did happen.
 */
export function quoteSubscription(input: QuoteInput): Quote {
  const seats = Math.max(0, Math.floor(input.seats))
  const periodEnd = input.periodEnd ?? addMonthUtc(input.periodStart)

  const seatAmount = input.plan.pricePerSeatMinor * seats

  const lines: QuoteLine[] = [
    {
      kind: 'seat',
      description: `${input.plan.displayName} — ${seats} connected ${
        seats === 1 ? 'account' : 'accounts'
      }`,
      quantity: seats,
      unitAmountMinor: input.plan.pricePerSeatMinor,
      amountMinor: seatAmount,
    },
  ]

  const subtotalMinor = seatAmount

  const taxMinor = input.taxRatePercent
    ? Math.max(0, roundMinor((subtotalMinor * input.taxRatePercent) / 100))
    : 0

  if (taxMinor > 0) {
    lines.push({
      kind: 'tax',
      description: `VAT at ${input.taxRatePercent}%`,
      quantity: 1,
      unitAmountMinor: taxMinor,
      amountMinor: taxMinor,
    })
  }

  const gross = subtotalMinor + taxMinor

  // Credit can wipe an invoice out entirely, but never past zero: the balance
  // stays on the credit and comes off the next one.
  const creditAppliedMinor = Math.min(Math.max(input.creditAvailableMinor ?? 0, 0), gross)

  if (creditAppliedMinor > 0) {
    lines.push({
      kind: 'credit',
      description: 'Credit from an earlier change of plan',
      quantity: 1,
      unitAmountMinor: -creditAppliedMinor,
      amountMinor: -creditAppliedMinor,
    })
  }

  return {
    lines,
    subtotalMinor,
    taxMinor,
    creditAppliedMinor,
    totalMinor: gross - creditAppliedMinor,
    periodStart: input.periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  }
}

/**
 * A mid-cycle seat purchase, billed to the end of the current cycle only.
 *
 * The new seat then renews with everything else, which is what keeps a
 * workspace on one invoice and one date rather than a drift of anniversaries.
 */
export function quoteAddedSeats(input: {
  plan: { displayName: string; pricePerSeatMinor: number }
  seats: number
  periodStart: Date
  periodEnd: Date
  at: Date
  creditAvailableMinor?: number
}): Quote {
  const seats = Math.max(0, Math.floor(input.seats))
  const unit = prorationMinor(
    input.plan.pricePerSeatMinor,
    input.periodStart,
    input.periodEnd,
    input.at,
  )

  const amountMinor = unit * seats

  const lines: QuoteLine[] = [
    {
      kind: 'proration',
      description: `${seats} more ${
        seats === 1 ? 'account' : 'accounts'
      } for the rest of this cycle`,
      quantity: seats,
      unitAmountMinor: unit,
      amountMinor,
    },
  ]

  const creditAppliedMinor = Math.min(
    Math.max(input.creditAvailableMinor ?? 0, 0),
    amountMinor,
  )

  if (creditAppliedMinor > 0) {
    lines.push({
      kind: 'credit',
      description: 'Credit from an earlier change of plan',
      quantity: 1,
      unitAmountMinor: -creditAppliedMinor,
      amountMinor: -creditAppliedMinor,
    })
  }

  return {
    lines,
    subtotalMinor: amountMinor,
    taxMinor: 0,
    creditAppliedMinor,
    totalMinor: amountMinor - creditAppliedMinor,
    periodStart: input.at.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
  }
}
