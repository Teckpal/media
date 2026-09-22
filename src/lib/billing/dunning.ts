import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { notifyBilling } from '@/lib/billing/activation'
import { addMonthUtc, graceUntil, quoteSubscription } from '@/lib/billing/pricing'
import { formatMoney } from '@/lib/money'
import { PAYMENT_GRACE_DAYS } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'

/**
 * Section 7.2, the renewal cycle.
 *
 *   "SSLCommerz is mainly one-time checkout, so renewal is an invoice plus
 *    reminders at 7, 3 and 1 days."
 *
 * Which means the cycle is ours to run, not the gateway's. This sweep is the
 * whole of it: raise the next invoice before it is due, remind, then — if it
 * goes unpaid — three days of grace, and only then withdraw publishing.
 *
 * What is withdrawn matters as much as when. Drafts, connections, media and
 * the calendar all stay. Section 7.2 takes away the ability to *send*, not the
 * work. A customer who pays late finds everything where they left it.
 */

/** How far ahead the next invoice is raised. Also the first reminder. */
const RENEWAL_LEAD_DAYS = 7
const REMINDER_DAYS = [7, 3, 1] as const
/** A checkout nobody completed is not pending for ever. */
const PENDING_PAYMENT_TTL_HOURS = 24

const DAY_MS = 24 * 60 * 60 * 1000

export type BillingSweepSummary = {
  invoicesRaised: number
  remindersSent: number
  movedToPastDue: number
  expired: number
  postsPaused: number
  seatsReleased: number
  aiGrantsExpired: number
  stalePaymentsClosed: number
}

export async function runBillingSweep(now = new Date()): Promise<BillingSweepSummary> {
  const summary: BillingSweepSummary = {
    invoicesRaised: 0,
    remindersSent: 0,
    movedToPastDue: 0,
    expired: 0,
    postsPaused: 0,
    seatsReleased: 0,
    aiGrantsExpired: 0,
    stalePaymentsClosed: 0,
  }

  await raiseRenewals(summary, now)
  await sendReminders(summary, now)
  await moveOverdueToPastDue(summary, now)
  await endGracePeriods(summary, now)
  await releaseLapsedSeats(summary, now)
  await closeStalePayments(summary, now)

  const { data: expired } = await createAdminClient().rpc('expire_lapsed_ai_grants')
  summary.aiGrantsExpired = expired ?? 0

  return summary
}

// --- raising the next invoice ------------------------------------------------

async function raiseRenewals(summary: BillingSweepSummary, now: Date): Promise<void> {
  const admin = createAdminClient()
  const horizon = new Date(now.getTime() + RENEWAL_LEAD_DAYS * DAY_MS)

  const { data: due } = await admin
    .from('subscriptions')
    .select('*')
    .eq('status', 'active')
    .lt('current_period_end', horizon.toISOString())
    .limit(200)

  for (const subscription of due ?? []) {
    const periodStart = new Date(subscription.current_period_end)

    // Already raised. Matching on the period rather than on a flag, so a
    // sweep that runs twice in a day cannot invoice twice.
    const { count: existing } = await admin
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', subscription.workspace_id)
      .eq('period_start', periodStart.toISOString())
      .in('status', ['open', 'paid'])

    if ((existing ?? 0) > 0) continue

    const { data: plan } = await admin
      .from('plans')
      .select('*')
      .eq('id', subscription.plan_id)
      .maybeSingle()

    if (!plan) continue

    // Seats are re-counted at renewal, so an account connected mid-cycle is
    // simply billed from the next one (Section 7.1's billing unit), and one
    // disconnected mid-cycle stops costing after the seat it already paid for.
    const { count: seatCount } = await admin
      .from('social_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', subscription.workspace_id)
      .in('status', ['active', 'needs_reconnect'])

    const seats = Math.max(1, seatCount ?? 0)

    const quote = quoteSubscription({
      plan: {
        displayName: plan.display_name,
        pricePerSeatMinor: plan.price_per_seat_minor,
      },
      seats,
      periodStart,
      periodEnd: addMonthUtc(periodStart),
    })

    const { data: invoice } = await admin
      .from('invoices')
      .insert({
        workspace_id: subscription.workspace_id,
        subscription_id: subscription.id,
        region: subscription.region,
        currency: subscription.currency,
        subtotal_minor: quote.subtotalMinor,
        tax_minor: quote.taxMinor,
        credit_applied_minor: 0,
        total_minor: quote.subtotalMinor + quote.taxMinor,
        status: 'open',
        period_start: quote.periodStart,
        period_end: quote.periodEnd,
        issued_at: now.toISOString(),
        // Due when the paid-for period actually runs out, not today. The
        // reminders are what make it arrive early; the deadline does not move.
        due_at: subscription.current_period_end,
      })
      .select('id')
      .single()

    if (!invoice) continue

    await admin.from('invoice_lines').insert(
      quote.lines
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

    summary.invoicesRaised += 1
  }
}

// --- reminders ---------------------------------------------------------------

async function sendReminders(summary: BillingSweepSummary, now: Date): Promise<void> {
  const admin = createAdminClient()

  const { data: open } = await admin
    .from('invoices')
    .select('id, workspace_id, total_minor, currency, due_at')
    .eq('status', 'open')
    .not('due_at', 'is', null)
    .gt('due_at', now.toISOString())
    .limit(500)

  for (const invoice of open ?? []) {
    const daysLeft = Math.ceil((new Date(invoice.due_at!).getTime() - now.getTime()) / DAY_MS)

    const milestone = REMINDER_DAYS.find((day) => day === daysLeft)
    if (!milestone) continue

    // One reminder per milestone per invoice, recognised by what was written
    // last time. A sweep that runs hourly must not send seven of them.
    const { count: already } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', invoice.workspace_id)
      .eq('kind', 'payment_due')
      .eq('data->>invoice_id', invoice.id)
      .eq('data->>milestone', String(milestone))

    if ((already ?? 0) > 0) continue

    await admin.from('notifications').insert({
      workspace_id: invoice.workspace_id,
      user_id: null,
      kind: 'payment_due',
      title:
        milestone === 1
          ? 'Your plan renews tomorrow'
          : `Your plan renews in ${milestone} days`,
      body: `${formatMoney(invoice.total_minor, invoice.currency)} is due. Publishing continues for ${PAYMENT_GRACE_DAYS} days past the due date.`,
      link_path: ROUTES.billing,
      data: { invoice_id: invoice.id, milestone: String(milestone) },
    })

    summary.remindersSent += 1
  }
}

// --- the due date passes -----------------------------------------------------

async function moveOverdueToPastDue(
  summary: BillingSweepSummary,
  now: Date,
): Promise<void> {
  const admin = createAdminClient()

  // Driven from the *subscription*, not from the invoice.
  //
  // An open invoice is not by itself evidence that anything is overdue: an
  // owner who renews early raises one that is payable now, for a cycle that
  // has not started. Reading it the other way round would put a perfectly
  // healthy subscription into past_due the day after they clicked Renew.
  //
  // What actually matters is that the paid-for period has run out and nothing
  // has been paid since.
  const { data: lapsed } = await admin
    .from('subscriptions')
    .select('id, workspace_id, current_period_end')
    .eq('status', 'active')
    .lt('current_period_end', now.toISOString())
    .limit(200)

  for (const subscription of lapsed ?? []) {
    const { count: unpaid } = await admin
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', subscription.workspace_id)
      .eq('status', 'open')

    // Nothing owed but the period has ended — a cancellation that ran its
    // course, or an invoice that has not been raised yet. Neither is a dunning
    // case, and the renewal sweep will have raised one by now if it should.
    if ((unpaid ?? 0) === 0) continue

    const until = graceUntil(new Date(subscription.current_period_end))

    await admin
      .from('subscriptions')
      .update({ status: 'past_due', grace_until: until.toISOString() })
      .eq('id', subscription.id)
      .eq('status', 'active')

    await notifyBilling({
      workspaceId: subscription.workspace_id,
      kind: 'payment_due',
      title: 'Your payment is overdue',
      body: `Publishing keeps working until ${until.toDateString()}. Your drafts and connections are safe either way.`,
    })

    summary.movedToPastDue += 1
  }
}

// --- grace runs out ----------------------------------------------------------

async function endGracePeriods(summary: BillingSweepSummary, now: Date): Promise<void> {
  const admin = createAdminClient()

  const { data: lapsed } = await admin
    .from('subscriptions')
    .select('id, workspace_id')
    .in('status', ['past_due', 'grace'])
    .not('grace_until', 'is', null)
    .lt('grace_until', now.toISOString())
    .limit(200)

  for (const subscription of lapsed ?? []) {
    await admin
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('id', subscription.id)
      .in('status', ['past_due', 'grace'])

    // Section 7.2: scheduled posts pause. Not cancelled, not deleted — paused,
    // so paying resumes exactly what was planned.
    const { data: paused } = await admin
      .from('posts')
      .update({ status: 'paused' })
      .eq('workspace_id', subscription.workspace_id)
      .eq('status', 'scheduled')
      .select('id')

    summary.postsPaused += paused?.length ?? 0
    summary.expired += 1

    await notifyBilling({
      workspaceId: subscription.workspace_id,
      kind: 'payment_failed',
      title: 'Publishing is paused',
      body:
        (paused?.length ?? 0) > 0
          ? `${paused!.length} scheduled ${paused!.length === 1 ? 'post is' : 'posts are'} on hold until the invoice is settled. Nothing has been deleted.`
          : 'Publishing is on hold until the invoice is settled. Nothing has been deleted.',
    })
  }
}

// --- seats and stale attempts ------------------------------------------------

/**
 * Section 7.2: a disconnected account keeps its seat to the end of the cycle.
 * This is the end of that cycle.
 */
async function releaseLapsedSeats(
  summary: BillingSweepSummary,
  now: Date,
): Promise<void> {
  const { data: released } = await createAdminClient()
    .from('social_accounts')
    .update({ paid_seat: false })
    .eq('paid_seat', true)
    .not('seat_paid_until', 'is', null)
    .lt('seat_paid_until', now.toISOString())
    .select('id')

  summary.seatsReleased = released?.length ?? 0
}

/**
 * A checkout the customer walked away from.
 *
 * Closed rather than left pending, so the billing page shows an honest state
 * and a later genuine payment is not confused with an abandoned one. The
 * invoice stays open — it is still owed.
 */
async function closeStalePayments(
  summary: BillingSweepSummary,
  now: Date,
): Promise<void> {
  const cutoff = new Date(now.getTime() - PENDING_PAYMENT_TTL_HOURS * 60 * 60 * 1000)

  const { data: closed } = await createAdminClient()
    .from('payments')
    .update({ status: 'failed', failure_reason: 'The checkout was not completed.' })
    .eq('status', 'pending')
    .lt('created_at', cutoff.toISOString())
    .select('id')

  summary.stalePaymentsClosed = closed?.length ?? 0
}
