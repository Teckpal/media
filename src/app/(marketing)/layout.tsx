import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { RegionSwitch } from '@/components/marketing/region-switch'
import { Wordmark } from '@/components/brand/wordmark'
import { buttonStyles } from '@/components/ui/button'
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
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <Link href={ROUTES.home} className="inline-block">
            <Wordmark />
          </Link>

          <div className="flex items-center gap-3">
            <RegionSwitch current={region} />

            {signedIn ? (
              <Link href={ROUTES.dashboard} className={buttonStyles({ size: 'sm' })}>
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href={ROUTES.login}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link href={ROUTES.signup} className={buttonStyles({ size: 'sm' })}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-8">
          <div className="space-y-1">
            <Wordmark className="text-base" />
            <p className="text-xs text-muted-foreground">
              Plan, schedule and publish across your social accounts.
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <Link href={ROUTES.home} className="hover:text-foreground">
              Global
            </Link>
            <Link href={ROUTES.bdLanding} className="hover:text-foreground">
              Bangladesh
            </Link>
            <Link href="/legal/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/legal/terms" className="hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
