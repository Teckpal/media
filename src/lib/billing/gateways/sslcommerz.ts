import 'server-only'

import { serverEnv } from '@/lib/env'
import { minorToDecimalString, decimalToMinor } from '@/lib/billing/amounts'
import { verifyIpnSignature } from '@/lib/billing/gateways/sslcommerz-sign'
import {
  GatewayError,
  type CallbackClaim,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentGateway,
  type ValidatedPayment,
} from '@/lib/billing/gateways/types'
import type { BillingRegion } from '@/lib/constants'
import type { CurrencyEnum } from '@/types/database'

/**
 * Bangladesh (Section 7A.1): cards, bKash, Nagad, Rocket, internet banking —
 * all of it behind one SSLCommerz session.
 *
 * Two things about this gateway shape the code:
 *
 * 1. It is a hosted checkout. We create a session, send the browser to
 *    SSLCommerz, and hear the result on a server-to-server IPN. The browser's
 *    own return is a *hint* — the user may close the tab before it fires, and
 *    a determined user can request the success URL by hand.
 * 2. It is mainly one-time checkout rather than a subscription engine. So the
 *    renewal cycle lives here, in our own invoices and reminders (Section 7.2),
 *    not in the gateway.
 */

const SANDBOX = 'https://sandbox.sslcommerz.com'
const LIVE = 'https://securepay.sslcommerz.com'

function config() {
  const env = serverEnv()
  return {
    storeId: env.SSLCOMMERZ_STORE_ID,
    storePassword: env.SSLCOMMERZ_STORE_PASSWORD,
    base: env.SSLCOMMERZ_MODE === 'live' ? LIVE : SANDBOX,
    mode: env.SSLCOMMERZ_MODE,
  }
}

function credentials() {
  const { storeId, storePassword, base, mode } = config()

  if (!storeId || !storePassword) {
    throw new GatewayError(
      'Payments are not set up for Bangladesh yet.',
      'SSLCOMMERZ_STORE_ID or SSLCOMMERZ_STORE_PASSWORD is unset',
    )
  }

  return { storeId, storePassword, base, mode }
}

type SessionResponse = {
  status?: string
  failedreason?: string
  sessionkey?: string
  GatewayPageURL?: string
}

type ValidationResponse = {
  status?: string
  tran_id?: string
  amount?: string
  currency?: string
  card_type?: string
  card_issuer_country?: string
  risk_level?: string
  error?: string
}

class SslcommerzGateway implements PaymentGateway {
  readonly id = 'sslcommerz' as const
  readonly region: BillingRegion = 'bd'

  isConfigured(): boolean {
    const { storeId, storePassword } = config()
    return Boolean(storeId && storePassword)
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const { storeId, storePassword, base } = credentials()

    if (request.currency !== 'BDT') {
      // A guard against a mis-routed checkout rather than a user-facing case:
      // the region decides the gateway, and BD is BDT (migration 0005's
      // currency-matches-region constraint says so too).
      throw new GatewayError(
        'That plan cannot be paid for here.',
        `sslcommerz asked for ${request.currency}`,
      )
    }

    const fields: Record<string, string> = {
      store_id: storeId,
      store_passwd: storePassword,
      total_amount: minorToDecimalString(request.amountMinor),
      currency: request.currency,
      tran_id: request.transactionId,

      success_url: request.urls.success,
      fail_url: request.urls.fail,
      cancel_url: request.urls.cancel,
      ipn_url: request.urls.ipn,

      product_name: request.description,
      product_category: 'subscription',
      product_profile: 'non-physical-goods',
      shipping_method: 'NO',
      num_of_item: '1',

      cus_name: request.customer.name,
      cus_email: request.customer.email,
      // SSLCommerz requires these fields to be present. We do not collect a
      // billing address — a per-account SaaS subscription does not need one —
      // so they carry the workspace rather than invented personal data.
      cus_add1: request.workspace.name,
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      cus_phone: 'N/A',

      value_a: request.invoiceId,
      value_b: request.workspace.id,
    }

    let response: Response
    try {
      response = await fetch(`${base}/gwprocess/v4/api.php`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (cause) {
      throw new GatewayError(
        'We could not reach the payment gateway. Try again in a moment.',
        `create session: ${String(cause)}`,
      )
    }

    const body = (await response.json().catch(() => ({}))) as SessionResponse

    if (body.status !== 'SUCCESS' || !body.GatewayPageURL) {
      throw new GatewayError(
        'The payment gateway would not start a checkout. Try again in a moment.',
        `create session: ${body.status ?? response.status} ${body.failedreason ?? ''}`.trim(),
      )
    }

    return { redirectUrl: body.GatewayPageURL, reference: body.sessionkey ?? null }
  }

  readCallback(fields: Record<string, string>): CallbackClaim | null {
    const transactionId = fields.tran_id
    if (!transactionId) return null

    const { storePassword } = config()

    return {
      transactionId,
      reference: fields.val_id ?? null,
      // `val_id` is unique per validated attempt; the transaction id is the
      // fallback so a failed callback with no val_id still logs exactly once.
      eventId: fields.val_id || `tran:${transactionId}`,
      eventType: fields.status ?? null,
      signatureVerified: storePassword
        ? verifyIpnSignature(fields, storePassword)
        : false,
    }
  }

  /**
   * The only thing that may mark an invoice paid.
   *
   * It asks SSLCommerz directly with the `val_id` from the callback, and then
   * checks the three things that matter: the gateway says it is valid, the
   * transaction is the one we think it is, and the amount and currency are the
   * invoice's own. A payment that is genuine but for the wrong amount is not a
   * payment of this invoice.
   */
  async validate(params: {
    transactionId: string
    reference: string | null
    expectedAmountMinor: number
    currency: CurrencyEnum
  }): Promise<ValidatedPayment> {
    const { storeId, storePassword, base } = credentials()

    if (!params.reference) {
      return {
        outcome: 'failed',
        amountMinor: null,
        currency: null,
        method: null,
        payerCountry: null,
        failureReason: 'The gateway did not give us anything to validate.',
        raw: null,
      }
    }

    const query = new URLSearchParams({
      val_id: params.reference,
      store_id: storeId,
      store_passwd: storePassword,
      format: 'json',
    })

    let response: Response
    try {
      response = await fetch(`${base}/validator/api/validationserverAPI.php?${query}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
    } catch (cause) {
      // Unreachable is not "failed". Saying failed here would mark a paid
      // invoice unpaid because of a network blip; pending means the dunning
      // sweep tries again.
      throw new GatewayError(
        'We could not confirm that payment with the gateway.',
        `validate: ${String(cause)}`,
      )
    }

    const body = (await response.json().catch(() => ({}))) as ValidationResponse
    const status = (body.status ?? '').toUpperCase()

    const amountMinor = decimalToMinor(body.amount)
    const method = body.card_type ?? null
    const payerCountry = body.card_issuer_country ?? null

    if (status !== 'VALID' && status !== 'VALIDATED') {
      return {
        outcome: status === 'PENDING' ? 'pending' : 'failed',
        amountMinor,
        currency: body.currency ?? null,
        method,
        payerCountry,
        failureReason: body.error || `The gateway reported ${status || 'no status'}.`,
        raw: body,
      }
    }

    // Right gateway, right status, wrong invoice: a validated transaction that
    // is not the one we asked about must never settle this one.
    if (body.tran_id && body.tran_id !== params.transactionId) {
      return {
        outcome: 'failed',
        amountMinor,
        currency: body.currency ?? null,
        method,
        payerCountry,
        failureReason: 'That payment belongs to a different order.',
        raw: body,
      }
    }

    if (amountMinor === null || amountMinor !== params.expectedAmountMinor) {
      return {
        outcome: 'failed',
        amountMinor,
        currency: body.currency ?? null,
        method,
        payerCountry,
        failureReason: 'The amount paid does not match the invoice.',
        raw: body,
      }
    }

    if ((body.currency ?? '').toUpperCase() !== params.currency) {
      return {
        outcome: 'failed',
        amountMinor,
        currency: body.currency ?? null,
        method,
        payerCountry,
        failureReason: 'The payment was made in a different currency.',
        raw: body,
      }
    }

    return {
      outcome: 'paid',
      amountMinor,
      currency: body.currency ?? null,
      method,
      payerCountry,
      raw: body,
    }
  }
}

export const sslcommerzGateway = new SslcommerzGateway()
