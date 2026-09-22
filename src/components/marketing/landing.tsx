import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { Pricing } from '@/components/marketing/pricing'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { buttonStyles } from '@/components/ui/button'
import type { RegionCopy } from '@/lib/marketing/copy'

/**
 * One landing page, rendered twice with different copy (Section 7A.1).
 *
 * The two regions differ in price, in how money moves and in who the page is
 * addressed to — not in what the product does. Keeping the structure in one
 * component is what stops the Bangladesh page quietly falling a feature behind
 * the other one.
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
    <div className="mx-auto w-full max-w-5xl space-y-20 px-4 pb-24 sm:px-8">
      {/*
        A suggestion, not a redirect. Sending a visitor somewhere they did not
        ask to go on the strength of an IP address is how a traveller ends up
        on the wrong page with no obvious way back — and it would make `/` an
        unstable thing to share.
      */}
      {suggestOtherRegion ? (
        <div className="pt-4">
          <Alert>
            {copy.otherRegion.prompt}{' '}
            <Link
              href={copy.otherRegion.path}
              className="font-medium text-primary hover:underline"
            >
              {copy.otherRegion.label}
            </Link>
            .
          </Alert>
        </div>
      ) : null}

      {/* --- hero --- */}
      <section className="space-y-6 pt-10 sm:pt-16">
        <p className="text-sm font-medium text-primary">{copy.hero.eyebrow}</p>

        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {copy.hero.heading}
        </h1>

        <p className="max-w-2xl text-lg text-muted-foreground">{copy.hero.subheading}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={signedIn ? '/dashboard' : copy.hero.primaryCta.href}
            className={buttonStyles({ size: 'lg' })}
          >
            {signedIn ? 'Go to your dashboard' : copy.hero.primaryCta.label}
            <ArrowRight className="size-4" aria-hidden />
          </Link>

          <Link
            href={copy.hero.secondaryCta.href}
            className={buttonStyles({ variant: 'secondary', size: 'lg' })}
          >
            {copy.hero.secondaryCta.label}
          </Link>
        </div>

        <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-2">
          {copy.proofPoints.map((point) => (
            <li key={point} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="size-4 shrink-0 text-success" aria-hidden />
              {point}
            </li>
          ))}
        </ul>
      </section>

      {/* --- what it does --- */}
      <section id="how" className="scroll-mt-16 space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">What it does</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          {copy.features.map((feature) => (
            <Card key={feature.title} className="space-y-2">
              <h3 className="font-medium">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <Pricing
        region={copy.region}
        heading={copy.pricingHeading}
        note={copy.pricingNote}
        paymentsLine={copy.paymentsLine}
      />

      {/* --- questions --- */}
      <section id="faq" className="scroll-mt-16 space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>

        <dl className="divide-y divide-border border-y border-border">
          {copy.faq.map((item) => (
            <div key={item.question} className="py-4">
              <dt className="font-medium">{item.question}</dt>
              <dd className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          Ready when you are.
        </h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          Create an account, connect a Page, and write your first post. You can
          decide about paying afterwards.
        </p>
        <Link
          href={signedIn ? '/dashboard' : copy.hero.primaryCta.href}
          className={buttonStyles({ size: 'lg' })}
        >
          {signedIn ? 'Go to your dashboard' : copy.hero.primaryCta.label}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>
    </div>
  )
}
