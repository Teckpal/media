import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ResendButton } from './resend-button'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/lib/routes'
import { getSessionUser } from '@/lib/auth/session'
import { signOutAction } from '@/lib/auth/actions'
import { openAccess } from '@/lib/billing/open-access'

export const metadata: Metadata = { title: 'Verify your email' }

const ERRORS: Record<string, string> = {
  invalid_link: 'That link was incomplete. Send yourself a new one below.',
  expired: 'That link has expired or was already used. Send a new one below.',
}

export default async function VerifyEmailPage({
  searchParams,
}: PageProps<'/verify-email'>) {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  // Section 5, rule 2 is a gate, not a room to sit in. Once the address is
  // verified this page has nothing to say, so hand back to the router.
  // Nothing to wait for if the gate is not asking. Landing here under
  // OPEN_ACCESS would be a dead end: no mail is sent, so the page would ask
  // the user to check an inbox that will stay empty.
  if (user.emailVerified || openAccess()) redirect(ROUTES.dashboard)

  const error = (await searchParams).error
  const message = typeof error === 'string' ? ERRORS[error] : undefined

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          We sent a link to <span className="text-foreground">{user.email}</span>. Open
          it to finish setting up.
        </p>
      </div>

      {message ? <Alert tone="warning">{message}</Alert> : null}

      <Alert>
        Connecting a social account comes next, and that only happens once this
        address is confirmed.
      </Alert>

      <ResendButton />

      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm" fullWidth>
          Sign out
        </Button>
      </form>
    </div>
  )
}
