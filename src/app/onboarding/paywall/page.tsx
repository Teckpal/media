import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Check } from 'lucide-react'
import { PayLaterButton } from './pay-later-button'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { buttonStyles } from '@/components/ui/button'
import { guardOnboardingStep, requireVerifiedUser } from '@/lib/auth/gate'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import { createClient } from '@/lib/supabase/server'
import { REGION_COOKIE, readRegionHint } from '@/lib/region'
import { formatMoney } from '@/lib/money'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Pick a plan' }

/**
 * Step 4, the paywall (Section 5, rule 5 and Section 7A).
 *
 * Checkout itself is Module 7. What is settled here is the shape Section 7A
 * asks for: two regional paywalls, prices read from the database by region, and
 * "pay later" as a first-class exit into unpaid mode.
 *
 * The region shown is a *guess* — the visitor's IP, or the country they gave at
 * signup. Section 7A.2 rule 3 is that the payment method has the final word, so
 * nothing here is binding and no price is ever taken from the browser.
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

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Pick a plan</h1>
        <p className="text-sm text-muted-foreground">
          Priced per connected account, per month. Scheduling and publishing need
          an active plan.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(plans ?? []).map((plan) => (
          <Card key={plan.id} className="flex flex-col gap-3">
            <div>
              <p className="font-medium">{plan.display_name}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {formatMoney(plan.price_per_seat_minor, plan.currency)}
              </p>
              <p className="text-xs text-muted-foreground">per account / month</p>
            </div>

            {plan.description ? (
              <p className="text-sm text-muted-foreground">{plan.description}</p>
            ) : null}

            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {plan.ai_credits_per_month.toLocaleString()} AI credits a month
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {plan.max_seats ? `Up to ${plan.max_seats} accounts` : 'Unlimited accounts'}
              </li>
            </ul>

            {/* Module 7 turns this into a real checkout. The price is resolved
                server-side from the plan id, never sent from here. */}
            <a
              href={`${ROUTES.billing}/checkout?plan=${plan.code}`}
              className={buttonStyles({ fullWidth: true, className: 'mt-auto' })}
            >
              Choose {plan.display_name}
            </a>
          </Card>
        ))}
      </div>

      <Alert title="Not ready yet?">
        You can go on without paying. You will be able to edit your setup, manage
        connections, write drafts and look at your calendar — but scheduling,
        publishing and inviting teammates stay locked until a plan is active.
      </Alert>

      <PayLaterButton />

      <p className="text-xs text-muted-foreground">
        {region === 'bd'
          ? 'Prices in BDT, paid through SSLCommerz. Bangladeshi cards and mobile wallets.'
          : 'Prices in USD. Your region is confirmed by the payment method you use.'}
      </p>
    </div>
  )
}
