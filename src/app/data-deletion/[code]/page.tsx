import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, HelpCircle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { PLATFORM_LABELS } from '@/lib/constants'
import type { PlatformEnum } from '@/types/database'

export const metadata: Metadata = {
  title: 'Data deletion',
  // A status page for one person's request has no business in an index.
  robots: { index: false, follow: false },
}

/**
 * What happened to a deletion request, for the person who made it.
 *
 * Reached from the confirmation code Meta shows after the app is removed. It
 * is public — there is no session, because the person asking is not a user
 * here and may never have been. The code is the only thing they have, so the
 * code is what identifies the request.
 *
 * The code is 12 characters from a 32-letter alphabet, which is around 60 bits
 * — not guessable — and the page reveals nothing but a count and a date. No
 * email address, no workspace name, no account names: somebody who found a
 * code should learn that a request was carried out, and nothing about whom.
 */
export default async function DataDeletionStatusPage({
  params,
}: PageProps<'/data-deletion/[code]'>) {
  const { code } = await params

  const { data: request } = await createAdminClient()
    .from('data_deletion_requests')
    .select('platform, accounts_removed, nothing_to_remove, completed_at, created_at')
    .eq('confirmation_code', code.toUpperCase())
    .maybeSingle<{
      platform: PlatformEnum
      accounts_removed: number
      nothing_to_remove: boolean
      completed_at: string | null
      created_at: string
    }>()

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 sm:px-8">
      <div className="rounded-[var(--radius)] border border-border bg-surface p-7">
        {request ? (
          <>
            <CheckCircle2 className="size-8 text-success" aria-hidden />

            <h1 className="mt-4 text-xl font-semibold tracking-tight">
              This request has been carried out
            </h1>

            <p className="mt-3 text-sm text-pretty text-muted-foreground">
              {request.nothing_to_remove
                ? `We held no ${PLATFORM_LABELS[request.platform]} data connected by that account, so there was nothing to remove.`
                : `We disconnected ${request.accounts_removed} ${
                    request.accounts_removed === 1 ? 'account' : 'accounts'
                  } connected through ${PLATFORM_LABELS[request.platform]} and deleted the access tokens behind them.`}
            </p>

            <dl className="mt-6 space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Confirmation code</dt>
                <dd className="font-mono">{code.toUpperCase()}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Completed</dt>
                <dd>
                  {new Date(request.completed_at ?? request.created_at).toLocaleDateString(
                    'en-GB',
                    { day: 'numeric', month: 'long', year: 'numeric' },
                  )}
                </dd>
              </div>
            </dl>

            {/*
              Said plainly, because the difference matters and a person is
              entitled to know what was NOT deleted as much as what was.
            */}
            <p className="mt-6 border-t border-border pt-4 text-xs text-pretty text-muted-foreground">
              Posts already published on the platform are unaffected — they live
              there, not here. Content created inside a workspace belongs to the
              business that owns it and is not removed by this request. To ask
              about that as well, see{' '}
              <Link href="/legal/data-deletion" className="underline hover:text-foreground">
                how to request deletion
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <HelpCircle className="size-8 text-muted-foreground" aria-hidden />

            <h1 className="mt-4 text-xl font-semibold tracking-tight">
              We have no record of that code
            </h1>

            <p className="mt-3 text-sm text-pretty text-muted-foreground">
              Check it for typos — codes use no letter O and no digits 0 or 1.
              If it still does not match, tell us at{' '}
              <a href="mailto:privacy@motif.example" className="underline hover:text-foreground">
                privacy@motif.example
              </a>{' '}
              and we will look it up.
            </p>

            <Link
              href="/legal/data-deletion"
              className="mt-6 inline-block text-sm underline hover:text-foreground"
            >
              How to request deletion
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
