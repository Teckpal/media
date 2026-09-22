import Link from 'next/link'
import { Check } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { buttonStyles } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { formatMoney } from '@/lib/money'
import { ROUTES } from '@/lib/routes'
import type { BillingRegion } from '@/lib/constants'
import type { PlanRow } from '@/types/database'

/**
 * The packages, read from the database.
 *
 * Section 7A.3: "Server reads price from DB by region + package." That applies
 * to the public page as much as to checkout — a price hard-coded into marketing
 * copy is a price that goes stale silently, and the first person to notice is a
 * customer who was quoted one number and charged another.
 *
 * `plans` has a public read policy (migration 0008) precisely so this page can
 * be rendered for a visitor who has not signed up.
 */
export async function Pricing({
  region,
  heading,
  note,
  paymentsLine,
}: {
  region: BillingRegion
  heading: string
  note: string
  paymentsLine: string
}) {
  const supabase = await createClient()

  const { data: plans } = await supabase
    .from('plans')
    .select('*')
    .eq('region', region)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .returns<PlanRow[]>()

  const packages = plans ?? []

  return (
    <section id="pricing" className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{heading}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{note}</p>
      </div>

      {packages.length === 0 ? (
        // Rather than an empty grid. If the catalogue cannot be read, saying so
        // is better than a page that looks like the product has no prices.
        <Card>
          <p className="text-sm text-muted-foreground">
            Our prices are not loading right now. Create an account and we will
            show them to you there, or get in touch.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {packages.map((plan) => (
            <Card key={plan.id} className="flex flex-col gap-3">
              <div>
                <p className="font-medium">{plan.display_name}</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight">
                  {formatMoney(plan.price_per_seat_minor, plan.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  per connected account / month
                </p>
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
                  {plan.max_seats
                    ? `Up to ${plan.max_seats} connected accounts`
                    : 'Unlimited connected accounts'}
                </li>
              </ul>

              <Link
                href={ROUTES.signup}
                className={buttonStyles({
                  variant: 'secondary',
                  fullWidth: true,
                  className: 'mt-auto',
                })}
              >
                Start with {plan.display_name}
              </Link>
            </Card>
          ))}
        </div>
      )}

      <p className="max-w-2xl text-sm text-muted-foreground">{paymentsLine}</p>
    </section>
  )
}
