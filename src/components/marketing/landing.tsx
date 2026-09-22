import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Hero } from '@/components/marketing/hero'
import { DashboardPreview } from '@/components/marketing/dashboard-preview'
import { HowItWorks, Networks, Pillars, Refusals } from '@/components/marketing/sections'
import { Pricing } from '@/components/marketing/pricing'
import type { RegionCopy } from '@/lib/marketing/copy'

/**
 * One landing page, rendered twice with different copy (Section 7A.1).
 *
 * The two regions differ in price, in how money moves and in who the page is
 * addressed to — not in what the product does. Keeping the structure in one
 * component is what stops the Bangladesh page quietly falling a feature behind
 * the other one.
 *
 * The page is dark in both colour schemes. It is built around photography that
 * is dark, so a light variant would be a different design rather than this one
 * inverted.
 */
export function Landing({
  copy,
  /** Shown when the visitor's IP suggests the *other* page. Never a redirect. */
  suggestOtherRegion,
  signedIn,
}: {
  copy: RegionCopy
  suggestOtherRegion: boolean
  signedIn: boolean
}) {
  return (
    <div className="bg-[var(--night)]">
      <Hero copy={copy} signedIn={signedIn} suggestOtherRegion={suggestOtherRegion} />

      <Networks networks={copy.networks} />
      <DashboardPreview />
      <Pillars pillars={copy.pillars} />
      <HowItWorks steps={copy.steps} />
      <Refusals refusals={copy.refusals} />

      {/* --- plans --- */}
      <section className="bg-[var(--night-band)] py-24">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <Pricing
            region={copy.region}
            heading={copy.pricingHeading}
            note={copy.pricingNote}
            paymentsLine={copy.paymentsLine}
          />
        </div>
      </section>

      {/* --- questions --- */}
      <section id="faq" className="scroll-mt-20 bg-[var(--night)] py-24">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Short answers
          </h2>

          <dl className="mt-12 divide-y divide-white/10 border-y border-white/10">
            {copy.faq.map((item) => (
              <div key={item.question} className="grid gap-2 py-6 sm:grid-cols-3 sm:gap-8">
                <dt className="font-medium text-balance text-white">{item.question}</dt>
                <dd className="text-sm text-pretty text-white/60 sm:col-span-2">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* --- closing --- */}
      <section className="bg-[var(--plum)] py-28">
        <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-8">
          <h2 className="text-3xl font-semibold tracking-tight text-balance text-white sm:text-5xl">
            {copy.hero.heading}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-white/70">
            Create an account, connect a Page, and write your first post. You can
            decide about paying afterwards.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={signedIn ? '/dashboard' : copy.hero.primaryCta.href}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-medium text-[var(--night)] transition-colors hover:bg-white/90"
            >
              {signedIn ? 'Go to your dashboard' : copy.hero.primaryCta.label}
              <ArrowRight className="size-4" aria-hidden />
            </Link>

            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-full border border-white/25 px-6 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              I already have an account
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
