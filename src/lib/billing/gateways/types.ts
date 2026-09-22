import type { BillingRegion } from '@/lib/constants'
import type { CurrencyEnum, PaymentGatewayEnum } from '@/types/database'

/**
 * Section 7A.3: two regions, two gateways, one flow.
 *
 * Bangladesh is SSLCommerz and is implemented. The global gateway is Section 13
 * Q6 and is still unanswered — Paddle, Lemon Squeezy and Stripe are all live
 * options, and they differ in who is merchant of record, which is a tax
 * question rather than a code one.
 *
 * So everything above this interface is written once, and answering Q6 means
 * writing one more file rather than reopening checkout, the webhook handler,
 * activation, dunning and the billing page.
 */

export type CheckoutRequest = {
  invoiceId: string
  /** Our reference. SSLCommerz calls it `tran_id`; it is what ties a callback back to us. */
  transactionId: string
  amountMinor: number
  currency: CurrencyEnum
  description: string
  workspace: { id: string; name: string }
  customer: { name: string; email: string }
  urls: {
    success: string
    fail: string
    cancel: string
    /** Server-to-server. The only callback that is allowed to change anything. */
    ipn: string
  }
}

export type CheckoutSession = {
  /** Where to send the browser. */
  redirectUrl: string
  /** The gateway's own handle on this attempt, when it issues one. */
  reference?: string | null
}

/**
 * What a callback tells us before anything is verified.
 *
 * Deliberately thin: a callback is an untrusted hint that *something* happened
 * to a transaction. What actually happened is decided by `validate`, which asks
 * the gateway directly.
 */
export type CallbackClaim = {
  transactionId: string
  /** The gateway's id for the attempt — SSLCommerz's `val_id`. */
  reference: string | null
  /** For the raw event log, so a replay is recognised. */
  eventId: string
  eventType: string | null
  signatureVerified: boolean
}

export type ValidatedPayment = {
  outcome: 'paid' | 'pending' | 'failed'
  amountMinor: number | null
  currency: string | null
  method: string | null
  /** Section 7A.2 rule 3 keeps the country for the record, even though the
   *  gateway that took the money is what decides the region. */
  payerCountry: string | null
  failureReason?: string | null
  raw: unknown
}

export class GatewayError extends Error {
  readonly detail?: string

  constructor(message: string, detail?: string) {
    super(message)
    this.name = 'GatewayError'
    this.detail = detail
  }
}

export interface PaymentGateway {
  readonly id: PaymentGatewayEnum
  readonly region: BillingRegion

  /**
   * Are the credentials actually present?
   *
   * Checked before a checkout is offered, so an unconfigured region says so on
   * the paywall instead of failing after the user has chosen a plan.
   */
  isConfigured(): boolean

  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>

  /** Reads a callback body. Returns null when it is not about a payment. */
  readCallback(fields: Record<string, string>): CallbackClaim | null

  /**
   * Asks the gateway what really happened, server to server.
   *
   * Nothing else may mark an invoice paid. Section 7.2 is explicit: a browser
   * redirect carrying `status=VALID` is a string a user can type.
   */
  validate(params: {
    transactionId: string
    reference: string | null
    expectedAmountMinor: number
    currency: CurrencyEnum
  }): Promise<ValidatedPayment>
}
