import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { gatewayById } from '@/lib/billing/gateways'
import { GatewayError } from '@/lib/billing/gateways/types'
import { ROUTES } from '@/lib/routes'
import type { BillingRegion } from '@/lib/constants'
import type { Json, PaymentGatewayEnum } from '@/types/database'

/**
 * Turning a callback into a subscription.
 *
 * Section 7.2 is unambiguous about what is allowed to do this: "only the
 * server-side IPN plus the gateway's validation API is trusted. A browser
 * redirect alone never sets this." So this function is reached from two places
 * — the IPN route, and the page the customer lands back on — and both go
 * through the same validation call. The customer's own return is treated as a
 * nudge to check, never as evidence.
 *
 * Everything that changes as a result happens inside `activate_paid_invoice`
 * (migration 0013), in one transaction, so a replayed callback activates
 * nothing twice.
 */

export type SettleResult =
  | { kind: 'activated'; invoiceId: string }
  | { kind: 'already'; invoiceId: string | null }
  | { kind: 'pending'; reason: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'unknown' }

export async function settlePayment(params: {
  gateway: PaymentGatewayEnum
  transactionId: string
  reference: string | null
}): Promise<SettleResult> {
  const admin = createAdminClient()
  const gateway = gatewayById(params.gateway)

  if (!gateway) return { kind: 'unknown' }

  const { data: payment } = await admin
    .from('payments')
    .select('*')
    .eq('gateway', params.gateway)
    .eq('gateway_transaction_id', params.transactionId)
    .maybeSingle()

  // A callback for a transaction we never started. Logged by the caller in
  // `gateway_events`; nothing here acts on it.
  if (!payment) return { kind: 'unknown' }

  if (payment.status === 'success') {
    return { kind: 'already', invoiceId: payment.invoice_id }
  }

  if (!payment.invoice_id) return { kind: 'unknown' }

  const { data: invoice } = await admin
    .from('invoices')
    .select('*')
    .eq('id', payment.invoice_id)
    .maybeSingle()

  if (!invoice) return { kind: 'unknown' }

  if (invoice.status === 'paid') {
    return { kind: 'already', invoiceId: invoice.id }
  }

  if (invoice.status === 'void') {
    await admin
      .from('payments')
      .update({
        status: 'failed',
        failure_reason: 'This checkout had already been replaced by a newer one.',
      })
      .eq('id', payment.id)
      .eq('status', 'pending')

    return { kind: 'failed', reason: 'That checkout had already been replaced.' }
  }

  let validated
  try {
    validated = await gateway.validate({
      transactionId: params.transactionId,
      reference: params.reference,
      expectedAmountMinor: invoice.total_minor,
      currency: invoice.currency,
    })
  } catch (cause) {
    // Could not ask. Not a failure — saying "failed" here would mark a paid
    // invoice unpaid over a network blip. It stays pending and the billing
    // sweep asks again.
    console.error(
      '[billing] validation unavailable for %s: %s',
      params.transactionId,
      cause instanceof GatewayError ? cause.detail : String(cause),
    )
    return { kind: 'pending', reason: 'We could not confirm that payment yet.' }
  }

  await admin
    .from('payments')
    .update({
      payment_method: validated.method,
      payer_country: validated.payerCountry,
      validation_response: (validated.raw ?? null) as Json,
    })
    .eq('id', payment.id)

  if (validated.outcome === 'pending') {
    return { kind: 'pending', reason: validated.failureReason ?? 'The payment is still being processed.' }
  }

  if (validated.outcome === 'failed') {
    const reason = validated.failureReason ?? 'The payment did not go through.'

    await admin
      .from('payments')
      .update({ status: 'failed', failure_reason: reason })
      .eq('id', payment.id)
      .eq('status', 'pending')

    await notifyBilling({
      workspaceId: invoice.workspace_id,
      kind: 'payment_failed',
      title: 'A payment did not go through',
      body: `${reason} Nothing has changed on your account — you can try again from Billing.`,
    })

    return { kind: 'failed', reason }
  }

  // Paid. What it bought is read here rather than trusted from anywhere: the
  // plan from the invoice's own lines would be ambiguous, so the seat line's
  // quantity and the plan matching this invoice's region and price are used.
  const activation = await applyPaidInvoice({
    paymentId: payment.id,
    invoiceId: invoice.id,
    workspaceId: invoice.workspace_id,
    region: invoice.region,
    gateway: params.gateway,
  })

  return activation
}

/**
 * Works out what the invoice bought, then applies it atomically.
 *
 * The seat count and the period come from the invoice itself, which was
 * written by `startCheckout` from prices read out of `plans`. Nothing here
 * re-derives a price, so there is no second opinion to disagree with the
 * amount the customer was actually charged.
 */
async function applyPaidInvoice(params: {
  paymentId: string
  invoiceId: string
  workspaceId: string
  region: BillingRegion
  gateway: PaymentGatewayEnum
}): Promise<SettleResult> {
  const admin = createAdminClient()

  const { data: lines } = await admin
    .from('invoice_lines')
    .select('kind, quantity, unit_amount_minor')
    .eq('invoice_id', params.invoiceId)

  const seatLine = (lines ?? []).find((line) => line.kind === 'seat')
  const seats = seatLine?.quantity ?? 1

  const { data: invoice } = await admin
    .from('invoices')
    .select('period_start, period_end, currency')
    .eq('id', params.invoiceId)
    .maybeSingle()

  // The plan the customer chose, identified by the price they were charged for
  // a seat. Recorded on the subscription so renewals and the billing page know
  // what they are renewing.
  const { data: plan } = await admin
    .from('plans')
    .select('id, code, ai_credits_per_month')
    .eq('region', params.region)
    .eq('price_per_seat_minor', seatLine?.unit_amount_minor ?? -1)
    .eq('is_active', true)
    .maybeSingle()

  if (!plan || !invoice?.period_start || !invoice.period_end) {
    // The money is in. Refusing to activate would be the worst of both worlds,
    // so this is escalated loudly rather than swallowed.
    console.error(
      '[billing] invoice %s is paid but could not be matched to a plan',
      params.invoiceId,
    )
    return { kind: 'failed', reason: 'We could not match that payment to a plan.' }
  }

  const { data: result, error } = await admin.rpc('activate_paid_invoice', {
    p_payment: params.paymentId,
    p_plan: plan.id,
    p_seats: seats,
    p_period_start: invoice.period_start,
    p_period_end: invoice.period_end,
    p_ai_credits: plan.ai_credits_per_month,
    p_region: params.region,
    p_gateway: params.gateway,
    p_source: `plan:${plan.code}`,
  })

  if (error) {
    console.error('[billing] activation of %s failed: %s', params.invoiceId, error.message)
    return { kind: 'failed', reason: 'We could not activate that plan.' }
  }

  const applied = (result as { applied?: boolean; region_note?: string | null } | null) ?? {}

  if (applied.region_note) {
    console.error(
      '[billing] region mismatch on invoice %s: %s',
      params.invoiceId,
      applied.region_note,
    )
  }

  if (!applied.applied) {
    return { kind: 'already', invoiceId: params.invoiceId }
  }

  await notifyBilling({
    workspaceId: params.workspaceId,
    kind: 'payment_succeeded',
    title: 'Your plan is active',
    body: `Publishing is open until ${new Date(invoice.period_end).toDateString()}.`,
  })

  return { kind: 'activated', invoiceId: params.invoiceId }
}

/**
 * Billing notifications go to the workspace rather than to a person.
 *
 * Section 6.3 makes billing the owner's alone, and who that is can change —
 * a notification addressed to whoever happened to click Pay would be lost the
 * moment they left the team.
 */
export async function notifyBilling(params: {
  workspaceId: string
  kind: string
  title: string
  body: string
}): Promise<void> {
  await createAdminClient().from('notifications').insert({
    workspace_id: params.workspaceId,
    user_id: null,
    kind: params.kind,
    title: params.title,
    body: params.body,
    link_path: ROUTES.billing,
    data: {},
  })
}
