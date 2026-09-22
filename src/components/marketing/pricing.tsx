import Link from 'next/link'
import { PlanCard } from '@/components/marketing/plan-card'
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
    <section id="pricing" className="scroll-mt-20">
      <h2 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
        {heading}
      </h2>
      <p className="mt-4 max-w-2xl text-pretty text-white/60">{note}</p>

      {packages.length === 0 ? (
        // Rather than an empty grid. If the catalogue cannot be read, saying so
        // is better than a page that looks like the product has no prices.
        <div className="mt-12 rounded-2xl border border-white/10 bg-white/[0.03] p-7">
          <p className="text-sm text-white/60">
            Our prices are not loading right now. Create an account and we will
            show them to you there, or get in touch.
          </p>
        </div>
      ) : (
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {packages.map((plan) => (
            <div key={plan.id} className="flex flex-col gap-3">
              <PlanCard
                name={plan.display_name}
                price={formatMoney(plan.price_per_seat_minor, plan.currency)}
                description={plan.description}
                includes={[
                  `${plan.ai_credits_per_month.toLocaleString()} AI credits a month`,
                  plan.max_seats
                    ? `Up to ${plan.max_seats} connected accounts`
                    : 'Unlimited connected accounts',
                  'Scheduling, the calendar and the publish queue',
                  'In-app and email alerts when something breaks',
                ]}
              />

              {/* Outside the card on purpose — see `PlanCard`. */}
              <Link
                href={ROUTES.signup}
                className="inline-flex h-11 w-full items-center justify-center rounded-[14px] border border-white/25 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Start with {plan.display_name}
              </Link>
            </div>
          ))}
        </div>
      )}

      <p className="mt-8 max-w-2xl text-sm text-pretty text-white/45">{paymentsLine}</p>
    </section>
  )
}
