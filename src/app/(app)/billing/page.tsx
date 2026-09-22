import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { PlanPicker, type PlanOption } from '@/components/billing/plan-picker'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import { regionCanCheckout } from '@/lib/billing/gateways'
import { formatMoney } from '@/lib/money'
import { REGION_COOKIE, readRegionHint } from '@/lib/region'
import { PAYMENT_GRACE_DAYS, type BillingRegion } from '@/lib/constants'
import type { InvoiceRow, PlanRow, SubscriptionRow } from '@/types/database'

export const metadata: Metadata = { title: 'Billing' }

/** What the customer is told about where a payment ended up. */
const PAYMENT_MESSAGES: Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  paid: { tone: 'success', text: 'Payment received. Your plan is active.' },
  pending: {
    tone: 'warning',
    text: 'Your bank has not confirmed that payment yet. This page will show it as soon as they do — there is no need to pay again.',
  },
  failed: {
    tone: 'danger',
    text: 'That payment did not go through. Nothing has been charged, and your invoice is still here.',
  },
  cancelled: {
    tone: 'warning',
    text: 'The payment was cancelled. Your invoice is still open whenever you are ready.',
  },
  unknown: {
    tone: 'warning',
    text: 'We could not match that payment to an invoice. If money has left your account, send us the reference and we will sort it out.',
  },
}

function statusLine(subscription: SubscriptionRow, graceDays: number): string {
  const renews = new Date(subscription.current_period_end).toDateString()

  switch (subscription.status) {
    case 'active':
      return `Renews on ${renews}.`
    case 'past_due':
    case 'grace':
      return subscription.grace_until
        ? `Payment is overdue. Publishing keeps working until ${new Date(subscription.grace_until).toDateString()}.`
        : `Payment is overdue. Publishing keeps working for ${graceDays} days past the due date.`
    case 'paused':
      return 'This subscription is paused.'
    case 'cancelled':
      return `Cancelled. Publishing works until ${renews}.`
    case 'expired':
      return 'This plan has lapsed, so scheduling and publishing are locked. Everything else is where you left it.'
  }
}

export default async function BillingPage({ searchParams }: PageProps<'/billing'>) {
  const { user, active } = await requireWorkspace()
  const query = await searchParams

  const supabase = await createClient()
  const isOwner = active.role === 'owner'

  // Section 7A.2 rule 4: once locked, the workspace's own region decides what
  // is on sale here. Before that, the hint from the toggle or the signup
  // country picks which of the two paywalls to show.
  const region: BillingRegion =
    active.workspace.billing_region ??
    readRegionHint(
      (await cookies()).get(REGION_COOKIE)?.value,
      user.profile.signup_country,
    )

  const { data: plans } = await supabase
    .from('plans')
    .select('*')
    .eq('region', region)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .returns<PlanRow[]>()

  const { count: seatCount } = await supabase
    .from('social_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', active.workspace.id)
    .in('status', ['active', 'needs_reconnect'])

  const seats = Math.max(1, seatCount ?? 0)

  // Section 6.3: the amounts are the owner's to see. A non-owner gets the one
  // fact they need — whether publishing is covered — from
  // `publishing_coverage`, which exposes no money.
  const { data: coverage } = await supabase.rpc('publishing_coverage', {
    ws: active.workspace.id,
  })

  const { data: subscription } = isOwner
    ? await supabase
        .from('subscriptions')
        .select('*')
        .eq('workspace_id', active.workspace.id)
        .in('status', ['active', 'past_due', 'grace', 'expired', 'cancelled'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<SubscriptionRow>()
    : { data: null }

  const { data: invoices } = isOwner
    ? await supabase
        .from('invoices')
        .select('*')
        .eq('workspace_id', active.workspace.id)
        .order('created_at', { ascending: false })
        .limit(12)
        .returns<InvoiceRow[]>()
    : { data: null }

  const currentPlanId = subscription?.plan_id ?? null
  const canCheckout = regionCanCheckout(region)

  const options: PlanOption[] = (plans ?? []).map((plan) => ({
    code: plan.code,
    displayName: plan.display_name,
    description: plan.description,
    priceLabel: formatMoney(plan.price_per_seat_minor, plan.currency),
    aiCredits: plan.ai_credits_per_month,
    maxSeats: plan.max_seats,
    totalLabel: formatMoney(plan.price_per_seat_minor * seats, plan.currency),
    tooSmall: plan.max_seats !== null && seats > plan.max_seats,
    current: plan.id === currentPlanId,
  }))

  const paymentMessage =
    typeof query.payment === 'string' ? PAYMENT_MESSAGES[query.payment] : undefined

  const openInvoice = (invoices ?? []).find((invoice) => invoice.status === 'open')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Priced per connected account, per month. Scheduling and publishing need
          an active plan; drafts, connections and your calendar never expire.
        </p>
      </div>

      {paymentMessage ? (
        <Alert tone={paymentMessage.tone}>{paymentMessage.text}</Alert>
      ) : null}

      {query.activated === '1' ? (
        <Alert tone="success">
          Your credit covered this cycle, so there was nothing to pay. The plan is
          active.
        </Alert>
      ) : null}

      {query.error === 'owner_only' ? (
        <Alert tone="warning">
          Only the workspace owner can change billing.
        </Alert>
      ) : null}

      {/* The state of play, for whoever is looking. */}
      {isOwner ? (
        <Card className="space-y-2">
          <h2 className="text-sm font-medium">Your plan</h2>

          {subscription ? (
            <>
              <p className="text-sm">
                {(plans ?? []).find((p) => p.id === subscription.plan_id)?.display_name ??
                  'Subscription'}{' '}
                · {subscription.seats} {subscription.seats === 1 ? 'account' : 'accounts'}
              </p>
              <p className="text-sm text-muted-foreground">
                {statusLine(subscription, PAYMENT_GRACE_DAYS)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No plan yet. Your drafts and connections are safe; publishing opens
              when a plan is active.
            </p>
          )}

          {active.workspace.billing_region ? (
            <p className="text-xs text-muted-foreground">
              Billed in {active.workspace.billing_region === 'bd' ? 'BDT' : 'USD'}. A
              region is fixed by the payment method used the first time, and
              changing it later is a cancel-and-reissue at renewal.
            </p>
          ) : null}
        </Card>
      ) : (
        <Card className="space-y-2">
          <h2 className="text-sm font-medium">Your plan</h2>
          <p className="text-sm text-muted-foreground">
            {coverage?.[0]
              ? `Publishing is covered until ${new Date(coverage[0].current_period_end).toDateString()}.`
              : 'This workspace has no active plan, so scheduling and publishing are locked.'}
          </p>
          <p className="text-xs text-muted-foreground">
            Billing is handled by the workspace owner.
          </p>
        </Card>
      )}

      {isOwner && openInvoice ? (
        <Alert tone="warning" title="You have an unpaid invoice">
          {formatMoney(openInvoice.total_minor, openInvoice.currency)}
          {openInvoice.due_at
            ? `, due ${new Date(openInvoice.due_at).toDateString()}`
            : ''}
          . Choosing a package below raises a fresh invoice and replaces this one.
        </Alert>
      ) : null}

      {/* Section 13 Q4: an exempt workspace is told so, rather than shown
          packages it must never be charged for. */}
      {active.workspace.is_billing_exempt ? (
        <Alert title="This workspace does not need a plan">
          Publishing is open here without a subscription. Nothing on this page
          will charge you.
        </Alert>
      ) : isOwner ? (
        <PlanPicker
          plans={options}
          seats={seats}
          canPay={canCheckout}
          unavailableReason={
            canCheckout
              ? null
              : region === 'bd'
                ? 'Payments are not set up yet. Please try again shortly.'
                : 'Card payments outside Bangladesh are not open yet — the gateway for your region is still being chosen. Talk to us and we will set you up directly.'
          }
        />
      ) : null}

      {isOwner && (invoices ?? []).length > 0 ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-medium">Invoices</h2>
          <ul className="divide-y divide-border text-sm">
            {(invoices ?? []).map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-muted-foreground">
                  #{invoice.number} ·{' '}
                  {new Date(invoice.created_at).toDateString()}
                </span>
                <span className="flex items-center gap-3">
                  <span>{formatMoney(invoice.total_minor, invoice.currency)}</span>
                  <span className="text-muted-foreground capitalize">{invoice.status}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}
