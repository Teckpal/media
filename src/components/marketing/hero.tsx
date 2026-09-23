import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { NetworkHero } from '@/components/marketing/network-hero'
import type { RegionCopy } from '@/lib/marketing/copy'

const HERO_BUTTON =
  'inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium transition-colors'

/**
 * The full-bleed opening: artwork behind, the promise in front.
 *
 * The text sits in normal flow and the gallery is absolutely positioned behind
 * it, rather than the other way round — so the section is as tall as its
 * content on a narrow screen and the heading can never be clipped.
 */
export function Hero({
  copy,
  suggestOtherRegion,
}: {
  copy: RegionCopy
  /** The visitor's IP suggests the other page. A nudge, never a redirect. */
  suggestOtherRegion: boolean
}) {
  /*
   * The landing does not short-circuit to the dashboard any more.
   *
   * It used to swap these for "Go to your dashboard" whenever a session
   * existed, which meant somebody with a stale cookie could never reach the
   * login page from here at all — the front door quietly stopped being a door.
   * Signing in is now always one deliberate step, and `/login` is where it
   * happens.
   */
  const primaryHref = copy.hero.primaryCta.href
  const primaryLabel = copy.hero.primaryCta.label

  return (
    <section className="relative isolate min-h-[42rem] overflow-hidden bg-[var(--night)]">
      <NetworkHero networks={copy.networks} />

      {/*
        More headroom on small screens than large ones, which looks backwards
        until you notice the header wraps to two rows there — and it floats over
        this, so the padding is what keeps it off the eyebrow.
      */}
      <div className="pointer-events-none relative mx-auto w-full max-w-6xl px-4 pt-36 pb-64 sm:px-8 sm:pt-32">
        <div className="pointer-events-auto max-w-2xl">
          {/*
            Inside the hero, because the header floats over the artwork — a
            banner in the page flow above it would be printed on.
          */}
          {suggestOtherRegion ? (
            <Link
              href={copy.otherRegion.path}
              className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-1.5 text-xs text-white/75 backdrop-blur-sm transition-colors hover:bg-white/10 hover:text-white"
            >
              {copy.otherRegion.prompt}
              <span className="font-medium text-white">{copy.otherRegion.label} →</span>
            </Link>
          ) : null}

          <p className="text-xs font-medium tracking-[0.18em] text-white/60 uppercase">
            {copy.hero.eyebrow}
          </p>

          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance text-white sm:text-6xl">
            {copy.hero.heading}
          </h1>

          <p className="mt-5 max-w-xl text-lg text-pretty text-white/75">
            {copy.hero.subheading}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href={primaryHref} className={`${HERO_BUTTON} bg-white text-[var(--night)] hover:bg-white/90`}>
              {primaryLabel}
              <ArrowRight className="size-4" aria-hidden />
            </Link>

            <Link
              href={copy.hero.secondaryCta.href}
              className={`${HERO_BUTTON} border border-white/25 text-white hover:bg-white/10`}
            >
              {copy.hero.secondaryCta.label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
