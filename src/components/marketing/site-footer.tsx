import Link from 'next/link'
import { Wordmark } from '@/components/brand/wordmark'
import { ROUTES } from '@/lib/routes'

/**
 * The public footer.
 *
 * The payments column is the part worth being careful with. Section 7A.4 has
 * not chosen a global provider, and the Global paywall currently reports itself
 * unconfigured — so this names the Bangladesh methods, which are real, and says
 * the global ones are not ready. A footer quietly listing card logos the
 * checkout cannot honour is the kind of small lie that costs a first sale.
 */

const BD_METHODS = ['Visa', 'Mastercard', 'bKash', 'Nagad', 'Rocket', 'Bank transfer']

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[var(--night)]">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* --- the company --- */}
          <div className="lg:col-span-2">
            <Wordmark className="text-base text-white" />
            <p className="mt-4 max-w-sm text-sm text-pretty text-white/55">
              motif Social is made by MOTiF, a studio in Dhaka. We look after
              social accounts for our own clients, which is why this exists:
              we wanted a calendar that told us when something broke instead of
              letting a post fail quietly at nine in the morning.
            </p>
            <p className="mt-5 text-sm text-white/55">
              <a href="mailto:hello@motif.example" className="transition-colors hover:text-white">
                hello@motif.example
              </a>
            </p>
          </div>

          {/* --- product --- */}
          <nav aria-labelledby="footer-product">
            <h2 id="footer-product" className="text-sm font-medium text-white">
              Product
            </h2>
            <ul className="mt-5 space-y-2.5 text-sm text-white/55">
              <li>
                <Link href="/#how" className="transition-colors hover:text-white">
                  How it works
                </Link>
              </li>
              <li>
                <Link href="/#pricing" className="transition-colors hover:text-white">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/#faq" className="transition-colors hover:text-white">
                  Questions
                </Link>
              </li>
              <li>
                <Link href={ROUTES.home} className="transition-colors hover:text-white">
                  Global
                </Link>
              </li>
              <li>
                <Link href={ROUTES.bdLanding} className="transition-colors hover:text-white">
                  Bangladesh
                </Link>
              </li>
            </ul>
          </nav>

          {/* --- payments --- */}
          <div>
            <h2 className="text-sm font-medium text-white">Payments</h2>

            <p className="mt-5 text-xs font-medium tracking-wide text-white/40 uppercase">
              Bangladesh — via SSLCommerz
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {BD_METHODS.map((method) => (
                <li
                  key={method}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/60"
                >
                  {method}
                </li>
              ))}
            </ul>

            <p className="mt-6 text-xs font-medium tracking-wide text-white/40 uppercase">Elsewhere</p>
            <p className="mt-2.5 text-xs text-pretty text-white/45">
              Not open yet. We are finishing our international payment provider
              and will say which one it is here when it is live.
            </p>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-7">
          <p className="text-xs text-white/40">
            © {new Date().getFullYear()} MOTiF. All rights reserved.
          </p>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/40">
            <Link href="/legal/privacy" className="transition-colors hover:text-white">
              Privacy
            </Link>
            <Link href="/legal/terms" className="transition-colors hover:text-white">
              Terms
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}
