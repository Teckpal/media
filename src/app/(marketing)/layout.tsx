import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { RegionSwitch } from '@/components/marketing/region-switch'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Wordmark } from '@/components/brand/wordmark'
import { isSignedIn } from '@/lib/marketing/visitor'
import { REGION_COOKIE, readRegionHint } from '@/lib/region'
import { ROUTES } from '@/lib/routes'

/**
 * The public shell: the landing pages and the legal pages.
 *
 * It reads the session, so a signed-in visitor arriving at the marketing site
 * is offered their dashboard rather than a sign-up form they do not need. That
 * makes these pages render per request — which is also true of the pricing
 * below them, since Section 7A.3 puts the prices in the database rather than
 * in the page.
 *
 * The session read goes through `isSignedIn`, which returns false rather than
 * throwing: a database that is briefly unreachable should not take the public
 * site down with it.
 */
export default async function MarketingLayout({ children }: LayoutProps<'/'>) {
  const [signedIn, cookieStore, headerList] = await Promise.all([
    isSignedIn(),
    cookies(),
    headers(),
  ])

  const region = readRegionHint(
    cookieStore.get(REGION_COOKIE)?.value,
    headerList.get('x-vercel-ip-country'),
  )

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--night)]">
      {/*
        Over the hero rather than above it. The artwork runs to the top of the
        page, so a header with its own background would cut a band across it.
      */}
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-8">
          <Link href={ROUTES.home} className="inline-block">
            <Wordmark className="text-white" />
          </Link>

          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            <RegionSwitch current={region} />

            {signedIn ? (
              <Link
                href={ROUTES.dashboard}
                className="inline-flex h-9 items-center rounded-full bg-white px-5 text-sm font-medium text-[var(--night)] transition-colors hover:bg-white/90"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href={ROUTES.login}
                  className="text-sm text-white/70 transition-colors hover:text-white"
                >
                  Log in
                </Link>
                <Link
                  href={ROUTES.signup}
                  className="inline-flex h-9 items-center rounded-full bg-white px-5 text-sm font-medium text-[var(--night)] transition-colors hover:bg-white/90"
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <SiteFooter />
    </div>
  )
}
