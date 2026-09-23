import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Deleting your data',
  description:
    'How to have the data motif Social holds about you removed, what gets deleted, and what does not.',
}

/**
 * The URL Meta asks for as "Data Deletion Instructions".
 *
 * A plain page, in the same register as the privacy policy: what to do, what
 * happens, and — the part most of these pages skip — what will NOT be deleted
 * and why. A person deciding whether to ask is owed both halves.
 */
export default function DataDeletionPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-8">
      <h1 className="text-3xl font-semibold tracking-tight text-white">Deleting your data</h1>

      <p className="mt-4 text-pretty text-white/70">
        You can have the data we hold about you removed. There are two routes,
        and which one you want depends on what you are asking us to forget.
      </p>

      <section className="mt-10 space-y-3">
        <h2 className="text-lg font-semibold text-white">
          Removing a connected social account
        </h2>
        <p className="text-sm text-pretty text-white/70">
          If you connected a Facebook Page or Instagram account to a workspace,
          you can remove it two ways. Inside the app, open{' '}
          <span className="text-white">Connections</span> and disconnect it.
          Or, on Facebook, go to{' '}
          <span className="text-white">
            Settings &amp; Privacy → Settings → Apps and Websites
          </span>
          , find motif Social and remove it.
        </p>
        <p className="text-sm text-pretty text-white/70">
          Either way we disconnect the account and delete the access tokens
          behind it. Removing the app on Facebook sends us a request
          automatically, and Facebook will show you a confirmation code you can
          check on this site at any time.
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-lg font-semibold text-white">
          Removing your account and everything in it
        </h2>
        <p className="text-sm text-pretty text-white/70">
          Email{' '}
          <a href="mailto:privacy@motif.example" className="text-white underline">
            privacy@motif.example
          </a>{' '}
          from the address you signed up with. We will confirm it is you, tell
          you what will go, and carry it out within 30 days.
        </p>
        <p className="text-sm text-pretty text-white/70">
          If you are the only owner of a workspace, deleting your account
          deletes the workspace with it — its posts, media, connections and
          history. We will say so before doing anything, so nobody loses a
          client&rsquo;s work by accident.
        </p>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-lg font-semibold text-white">What we do not delete</h2>
        <ul className="space-y-2.5 text-sm text-white/70">
          <li className="flex gap-3">
            <span aria-hidden className="text-white/35">
              —
            </span>
            <span>
              <span className="text-white">Posts already published.</span> They
              live on Facebook, Instagram or wherever they went, not here.
              Removing them is done there, by you.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="text-white/35">
              —
            </span>
            <span>
              <span className="text-white">A workspace you do not own.</span>{' '}
              Leaving a workspace removes you from it; the work you did there
              belongs to the business that owns it and stays.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="text-white/35">
              —
            </span>
            <span>
              <span className="text-white">Invoices and payment records.</span>{' '}
              We are required to keep these, and for how long depends on where
              the business is. They hold no social account data.
            </span>
          </li>
        </ul>
      </section>

      <p className="mt-10 border-t border-white/10 pt-6 text-sm text-white/55">
        See also our{' '}
        <Link href="/legal/privacy" className="underline hover:text-white">
          privacy policy
        </Link>
        , which describes everything we store and why.
      </p>
    </div>
  )
}
