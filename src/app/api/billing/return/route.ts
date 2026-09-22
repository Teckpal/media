import { redirect } from 'next/navigation'
import { gatewayById } from '@/lib/billing/gateways'
import { settlePayment } from '@/lib/billing/activation'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/routes'
import type { PaymentGatewayEnum } from '@/types/database'

/**
 * Where the customer lands after the payment page.
 *
 * Public, and it has to be: SSLCommerz returns the browser with a cross-site
 * POST, which carries no session cookie. There is nothing to protect here in
 * any case — the route settles by transaction id, and settlement re-validates
 * with the gateway before it believes anything (Section 7.2).
 *
 * It exists for one reason. The IPN is the authority, but it can be slow, and
 * a customer who has just paid should not be shown an unpaid account while
 * they wait. Both paths run the same idempotent settlement, so whichever
 * arrives second finds the work already done.
 *
 * The `state` in the URL is the gateway's *claim* about what happened. It is
 * used to choose a message when there is nothing to validate — a cancelled
 * payment has no transaction to ask about — and for nothing else.
 */

async function handleReturn(request: Request): Promise<never> {
  const url = new URL(request.url)
  const state = url.searchParams.get('state') ?? 'success'
  const reference = url.searchParams.get('ref') ?? ''

  let fields: Record<string, string> = {}
  if (request.method === 'POST') {
    try {
      const form = await request.formData()
      fields = Object.fromEntries(
        [...form.entries()].map(([key, value]) => [key, String(value)]),
      )
    } catch {
      fields = {}
    }
  }

  const transactionId = fields.tran_id || reference

  if (!transactionId) {
    redirect(`${ROUTES.billing}?payment=unknown`)
  }

  const admin = createAdminClient()
  const { data: payment } = await admin
    .from('payments')
    .select('gateway, status')
    .eq('gateway_transaction_id', transactionId)
    .maybeSingle()

  if (!payment) {
    redirect(`${ROUTES.billing}?payment=unknown`)
  }

  if (state === 'cancel') {
    // Nothing was charged, so there is nothing to validate. The invoice stays
    // open and the customer can pay it from Billing whenever they like.
    await admin
      .from('payments')
      .update({ status: 'failed', failure_reason: 'The payment was cancelled.' })
      .eq('gateway_transaction_id', transactionId)
      .eq('status', 'pending')

    redirect(`${ROUTES.billing}?payment=cancelled`)
  }

  const gateway = gatewayById(payment.gateway as PaymentGatewayEnum)
  if (!gateway) {
    redirect(`${ROUTES.billing}?payment=unknown`)
  }

  const claim = gateway.readCallback(fields)

  const result = await settlePayment({
    gateway: payment.gateway,
    transactionId,
    // The gateway's own reference when it came back with one; otherwise the
    // IPN is the only thing that can confirm this, and the answer is "pending"
    // rather than a guess.
    reference: claim?.reference ?? null,
  })

  const outcome =
    result.kind === 'activated' || result.kind === 'already'
      ? 'paid'
      : result.kind === 'pending'
        ? 'pending'
        : 'failed'

  redirect(`${ROUTES.billing}?payment=${outcome}`)
}

export async function POST(request: Request) {
  return handleReturn(request)
}

/**
 * Some gateways — and every "open the success URL by hand" — arrive as a GET.
 * It runs the same settlement, which is the point: nothing about this route
 * trusts how it was reached.
 */
export async function GET(request: Request) {
  return handleReturn(request)
}
