import 'server-only'

import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { gatewayForRegion } from '@/lib/billing/gateways'
import { GatewayError } from '@/lib/billing/gateways/types'
import { quoteSubscription, addMonthUtc, type Quote } from '@/lib/billing/pricing'
import { publicEnv } from '@/lib/env'
import { ROUTES } from '@/lib/routes'
import type { BillingRegion } from '@/lib/constants'
import type { CurrencyEnum, PlanRow } from '@/types/database'

/**
 * Raising an invoice and sending someone to pay it.
 *
 * Section 7A.3, the rule this whole module is built around: "the server reads
 * the price from the DB by region + package. Never trust a price sent from the
 * browser." So what arrives from the form is a plan *code* and nothing else.
 * Every number below is read here or computed from what was read.
 *
 * Writes go through the service role, because Section 6.3 puts billing in the
 * owner's hands alone and migration 0008 gives clients no write policy at all
 * on these tables. The caller proves ownership before getting this far.
 */

export type CheckoutOutcome =
  | { kind: 'redirect'; url: string; invoiceId: string }
  /** Credit covered the whole invoice, so there was nothing to pay. */
  | { kind: 'activated'; invoiceId: string }
  | { kind: 'error'; message: string }

type CheckoutInput = {
  workspace: {
    id: string
    name: string
    billing_region: BillingRegion | null
    is_billing_exempt: boolean
  }
  actor: { id: string; name: string; email: string }
  planCode: string
  /** Only consulted when the workspace has not yet locked a region. */
  regionHint: BillingRegion
}

/** Seats are connected accounts (Section 7.1), whether or not they are healthy. */
async function countSeats(workspaceId: string): Promise<number> {
  const { count } = await createAdminClient()
    .from('social_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'needs_reconnect'])

  // A workspace cannot reach checkout without a connection (Section 5 rule 3),
  // but a subscription for nothing would be a strange thing to sell, so one is
  // the floor.
  return Math.max(1, count ?? 0)
}

async function availableCreditMinor(
  workspaceId: string,
  currency: CurrencyEnum,
): Promise<number> {
  const { data } = await createAdminClient()
    .from('billing_credits')
    .select('remaining_minor')
    .eq('workspace_id', workspaceId)
    .eq('currency', currency)
    .gt('remaining_minor', 0)

  return (data ?? []).reduce((total, row) => total + row.remaining_minor, 0)
}

/**
 * Clears the way for a new invoice.
 *
 * A customer who starts checkout, thinks better of it and starts again should
 * not end up with two open invoices, two reservations of the same credit and
 * two transactions the gateway might both settle. The previous attempt is
 * voided and its credit released first.
 */
async function voidOpenInvoices(workspaceId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: open } = await admin
    .from('invoices')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'open')

  for (const invoice of open ?? []) {
    await admin.rpc('release_billing_credits', { inv: invoice.id })
    await admin
      .from('invoices')
      .update({ status: 'void', voided_at: new Date().toISOString() })
      .eq('id', invoice.id)
      .eq('status', 'open')

    // The gateway may still settle a transaction against a voided invoice;
    // `activate_paid_invoice` refuses to act on one, and the payment is left
    // for support to refund rather than silently applied to something else.
    await admin
      .from('payments')
      .update({ status: 'failed', failure_reason: 'Checkout was restarted.' })
      .eq('invoice_id', invoice.id)
      .eq('status', 'pending')
  }
}

export async function startCheckout(input: CheckoutInput): Promise<CheckoutOutcome> {
  const admin = createAdminClient()

  // Section 13 Q4: Self (MOTiF) and any other exempt workspace publishes
  // without a plan. Taking their money would be a bug with a receipt.
  if (input.workspace.is_billing_exempt) {
    return {
      kind: 'error',
      message: 'This workspace does not need a plan — publishing is already open.',
    }
  }

  // Section 7A.2 rule 4: once locked, the region is the workspace's own and a
  // hint from a cookie or an IP cannot move it.
  const region: BillingRegion = input.workspace.billing_region ?? input.regionHint

  const { data: plan } = await admin
    .from('plans')
    .select('*')
    .eq('code', input.planCode)
    .eq('region', region)
    .eq('is_active', true)
    .maybeSingle<PlanRow>()

  if (!plan) {
    return { kind: 'error', message: 'That plan is not available.' }
  }

  const gateway = gatewayForRegion(region)
  if (!gateway.isConfigured()) {
    return {
      kind: 'error',
      message:
        region === 'bd'
          ? 'Payments are not set up yet. Please try again shortly.'
          : 'Card payments outside Bangladesh are not open yet. Talk to us and we will set you up directly.',
    }
  }

  const seats = await countSeats(input.workspace.id)

  if (plan.max_seats !== null && seats > plan.max_seats) {
    return {
      kind: 'error',
      message: `${plan.display_name} covers up to ${plan.max_seats} accounts and this workspace has ${seats}. Pick a larger package.`,
    }
  }

  await voidOpenInvoices(input.workspace.id)

  const now = new Date()

  // An owner who renews early — or upgrades mid-cycle — keeps the days they
  // have already paid for: the new cycle starts where the current one ends.
  // Starting it "now" would quietly shorten the month they bought.
  const { data: live } = await admin
    .from('subscriptions')
    .select('current_period_end')
    .eq('workspace_id', input.workspace.id)
    .in('status', ['active', 'past_due', 'grace'])
    .maybeSingle()

  const periodStart =
    live && new Date(live.current_period_end) > now
      ? new Date(live.current_period_end)
      : now

  const quote = quoteSubscription({
    plan: { displayName: plan.display_name, pricePerSeatMinor: plan.price_per_seat_minor },
    seats,
    creditAvailableMinor: await availableCreditMinor(input.workspace.id, plan.currency),
    periodStart,
    periodEnd: addMonthUtc(periodStart),
  })

  const { data: invoice, error: invoiceError } = await admin
    .from('invoices')
    .insert({
      workspace_id: input.workspace.id,
      region,
      currency: plan.currency,
      subtotal_minor: quote.subtotalMinor,
      tax_minor: quote.taxMinor,
      credit_applied_minor: 0, // set once the credit is actually reserved
      total_minor: quote.subtotalMinor + quote.taxMinor,
      status: 'open',
      period_start: quote.periodStart,
      period_end: quote.periodEnd,
      issued_at: now.toISOString(),
      due_at: now.toISOString(),
    })
    .select('id')
    .single()

  if (invoiceError || !invoice) {
    return { kind: 'error', message: 'We could not raise that invoice. Try again.' }
  }

  await admin.from('invoice_lines').insert(
    quote.lines
      // The credit line is written after the reservation tells us what was
      // really available, so it is not inserted from the quote.
      .filter((line) => line.kind !== 'credit')
      .map((line) => ({
        invoice_id: invoice.id,
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unit_amount_minor: line.unitAmountMinor,
        amount_minor: line.amountMinor,
      })),
  )

  // Reserve the credit for real. Another checkout may have taken some between
  // the quote and here, so the invoice follows the reservation rather than the
  // other way round — the customer is never charged less than we hold.
  const gross = quote.subtotalMinor + quote.taxMinor
  const { data: applied } = await admin.rpc('consume_billing_credits', {
    ws: input.workspace.id,
    inv: invoice.id,
    cur: plan.currency,
    max_minor: quote.creditAppliedMinor,
  })

  const creditApplied = applied ?? 0
  const totalMinor = gross - creditApplied

  if (creditApplied > 0) {
    await admin.from('invoice_lines').insert({
      invoice_id: invoice.id,
      kind: 'credit',
      description: 'Credit from an earlier change of plan',
      quantity: 1,
      unit_amount_minor: -creditApplied,
      amount_minor: -creditApplied,
    })
  }

  await admin
    .from('invoices')
    .update({ credit_applied_minor: creditApplied, total_minor: totalMinor })
    .eq('id', invoice.id)

  // Our own reference, and the one the gateway echoes back. Short, unique and
  // meaningless — it travels through a third party's logs.
  const transactionId = `motif-${randomUUID()}`

  const { data: payment, error: paymentError } = await admin
    .from('payments')
    .insert({
      workspace_id: input.workspace.id,
      invoice_id: invoice.id,
      gateway: gateway.id,
      gateway_transaction_id: transactionId,
      amount_minor: totalMinor,
      currency: plan.currency,
      status: 'pending',
    })
    .select('id')
    .single()

  if (paymentError || !payment) {
    return { kind: 'error', message: 'We could not start that payment. Try again.' }
  }

  // Credit covered the lot. There is nothing for a gateway to do, and sending
  // someone to pay zero would fail at the gateway rather than here.
  if (totalMinor === 0) {
    const { error } = await admin.rpc('activate_paid_invoice', {
      p_payment: payment.id,
      p_plan: plan.id,
      p_seats: seats,
      p_period_start: quote.periodStart,
      p_period_end: quote.periodEnd,
      p_ai_credits: plan.ai_credits_per_month,
      p_region: region,
      p_gateway: gateway.id,
      p_source: `plan:${plan.code}`,
    })

    if (error) {
      return { kind: 'error', message: 'We could not activate that plan. Try again.' }
    }

    return { kind: 'activated', invoiceId: invoice.id }
  }

  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '')

  try {
    const session = await gateway.createCheckout({
      invoiceId: invoice.id,
      transactionId,
      amountMinor: totalMinor,
      currency: plan.currency,
      description: `motif Social — ${plan.display_name}`,
      workspace: { id: input.workspace.id, name: input.workspace.name },
      customer: { name: input.actor.name, email: input.actor.email },
      urls: {
        success: `${appUrl}${ROUTES.billingReturn}?state=success&ref=${transactionId}`,
        fail: `${appUrl}${ROUTES.billingReturn}?state=fail&ref=${transactionId}`,
        cancel: `${appUrl}${ROUTES.billingReturn}?state=cancel&ref=${transactionId}`,
        ipn: `${appUrl}/api/webhooks/${gateway.id}/ipn`,
      },
    })

    return { kind: 'redirect', url: session.redirectUrl, invoiceId: invoice.id }
  } catch (cause) {
    const message =
      cause instanceof GatewayError
        ? cause.message
        : 'We could not reach the payment gateway. Try again in a moment.'

    console.error(
      '[billing] checkout failed for workspace %s: %s',
      input.workspace.id,
      cause instanceof GatewayError ? cause.detail : String(cause),
    )

    await admin
      .from('payments')
      .update({ status: 'failed', failure_reason: 'Checkout could not be started.' })
      .eq('id', payment.id)

    return { kind: 'error', message }
  }
}

export type { Quote }
