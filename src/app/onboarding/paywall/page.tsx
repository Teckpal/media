import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { PayLaterButton } from './pay-later-button'
import { PlanPicker, type PlanOption } from '@/components/billing/plan-picker'
import { Alert } from '@/components/ui/alert'
import { guardOnboardingStep, requireVerifiedUser } from '@/lib/auth/gate'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import { createClient } from '@/lib/supabase/server'
import { regionCanCheckout } from '@/lib/billing/gateways'
import { openAccess } from '@/lib/billing/open-access'
import { REGION_COOKIE, readRegionHint } from '@/lib/region'
import { formatMoney } from '@/lib/money'
import { ROUTES } from '@/lib/routes'
import type { PlanRow } from '@/types/database'

export const metadata: Metadata = { title: 'Pick a plan' }

/**
 * Step 4, the paywall (Section 5, rule 5 and Section 7A).
 *
 * Two regional paywalls, prices read from the database by region, and "pay
 * later" as a first-class exit into unpaid mode.
 *
 * The region shown is a *guess* — the visitor's IP, or the country they gave at
 * signup. Section 7A.2 rule 3 is that the payment method has the final word, so
 * nothing here is binding and no price is ever taken from the browser. The
 * picker posts a plan code; Module 7's checkout reads the price itself.
 */
export default async function PaywallPage() {
  const user = await requireVerifiedUser()
  guardOnboardingStep(user, 'paywall', STEP_ORDER)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  const supabase = await createClient()

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('billing_region')
    .eq('id', workspaceId)
    .maybeSingle()

  // Locked region wins; otherwise the toggle, otherwise the signup country.
  const region =
    workspace?.billing_region ??
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

  // Section 7.1's billing unit. Step 2 guarantees at least one connection, so
  // this is the number the customer will actually be charged for.
  const { count: seatCount } = await supabase
    .from('social_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'needs_reconnect'])

  const seats = Math.max(1, seatCount ?? 0)

  const options: PlanOption[] = (plans ?? []).map((plan) => ({
    code: plan.code,
    displayName: plan.display_name,
    description: plan.description,
    priceLabel: formatMoney(plan.price_per_seat_minor, plan.currency),
    aiCredits: plan.ai_credits_per_month,
    maxSeats: plan.max_seats,
    totalLabel: formatMoney(plan.price_per_seat_minor * seats, plan.currency),
    tooSmall: plan.max_seats !== null && seats > plan.max_seats,
    current: false,
  }))

  const canCheckout = regionCanCheckout(region)
  const free = openAccess()

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Pick a plan</h1>
        <p className="text-sm text-muted-foreground">
          Priced per connected account, per month. Scheduling and publishing need
          an active plan.
        </p>
      </div>

      {/* Under OPEN_ACCESS there is nothing to choose, and offering a plan
          that would not be charged for is a worse lie than saying so. The
          picker and the "you will be limited" notice are both replaced by the
          truth, and "I will decide later" below becomes the way through. */}
      {free ? (
        <Alert title="Everything is open while we are in testing">
          No plan is needed yet. Scheduling, publishing and the whole team are
          available to you now — carry on below, and pricing will arrive before
          anything is ever charged.
        </Alert>
      ) : (
        <>
          <PlanPicker
            plans={options}
            seats={seats}
            canPay={canCheckout}
            unavailableReason={
              canCheckout
                ? null
                : 'Card payments outside Bangladesh are not open yet. You can carry on without paying and we will set you up directly.'
            }
          />

          <Alert title="Not ready yet?">
            You can go on without paying. You will be able to edit your setup,
            manage connections, write drafts and look at your calendar — but
            scheduling, publishing and inviting teammates stay locked until a
            plan is active.
          </Alert>
        </>
      )}

      <PayLaterButton label={free ? 'Continue to your dashboard' : undefined} />

      {free ? null : (
        <p className="text-xs text-muted-foreground">
          {region === 'bd'
            ? 'Prices in BDT, paid through SSLCommerz. Bangladeshi cards and mobile wallets.'
            : 'Prices in USD. Your region is confirmed by the payment method you use.'}
        </p>
      )}
    </div>
  )
}
