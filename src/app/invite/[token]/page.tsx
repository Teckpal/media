import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { XCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { buttonStyles } from '@/components/ui/button'
import { getSessionUser } from '@/lib/auth/session'
import { acceptInvite } from '@/lib/team/actions'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Join a workspace' }

/**
 * Section 4: the invite branch of the router.
 *
 * A signed-out visitor is sent to sign in first and returned here afterwards,
 * because an invitation is bound to an email address and there is nobody to
 * check it against until they have proved one.
 *
 * Redeeming on GET is deliberate. The alternative — a page with a button —
 * reads better in principle, but an invitation link is already a single-use
 * secret that arrives by email: whoever opens it is whoever was sent it, and
 * asking them to press an extra button protects nothing. Every reason to
 * refuse is checked in `acceptInvite`, and a second visit finds the invite
 * already consumed and says so rather than doing anything twice.
 */
export default async function InvitePage({ params }: PageProps<'/invite/[token]'>) {
  const { token } = await params

  const user = await getSessionUser()

  if (!user) {
    // Straight back here once they are signed in, so the link is not wasted.
    redirect(`${ROUTES.login}?next=${encodeURIComponent(`/invite/${token}`)}`)
  }

  const result = await acceptInvite(token, { id: user.id, email: user.email })

  if (result.ok) redirect(ROUTES.dashboard)

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16 sm:px-8">
      <Card className="space-y-4 text-center">
        <XCircle className="mx-auto size-8 text-danger" aria-hidden />

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">
            This invitation cannot be used
          </h1>
          <p className="text-sm text-pretty text-muted-foreground">{result.reason}</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link href={ROUTES.dashboard} className={buttonStyles({ variant: 'secondary' })}>
            Go to your dashboard
          </Link>
        </div>
      </Card>
    </div>
  )
}
