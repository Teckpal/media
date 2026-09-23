import type { Metadata } from 'next'
import Link from 'next/link'
import { LoginForm } from './login-form'
import { Alert } from '@/components/ui/alert'
import { buttonStyles } from '@/components/ui/button'
import { ROUTES } from '@/lib/routes'
import { getSessionUser } from '@/lib/auth/session'
import { safeNext } from '@/lib/auth/safe-next'

export const metadata: Metadata = { title: 'Sign in' }

const ERRORS: Record<string, string> = {
  missing_code: 'That link was incomplete. Sign in below.',
  exchange_failed: 'That link has already been used or has expired.',
}

/**
 * Not an error: being signed out after half an hour is the system working.
 * Said in its own tone so it does not read as something going wrong.
 */
const EXPIRED = 'You were signed out after 30 minutes of inactivity. Sign in to carry on.'

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  /**
   * A signed-in visitor sees the form, not a redirect.
   *
   * This used to bounce them straight to the dashboard, which reads as
   * reasonable and is not: somebody who deliberately asked for the login page
   * got sent away from it, with no way to sign in as a different person short
   * of finding Sign out first. Combined with a landing page that also
   * short-circuited to the dashboard, the login screen became unreachable —
   * which is exactly how it looked "missing".
   *
   * So the session is reported, not acted on. Continuing is one click, and
   * signing in as somebody else is simply filling the form in.
   */
  const current = await getSessionUser()

  const params = await searchParams
  const error = params.error
  const message = typeof error === 'string' ? ERRORS[error] : undefined
  const expired = params.expired === '1'

  // Checked here as well as in the action, so a hostile `next` never reaches
  // the markup at all.
  const next = safeNext(params.next, '')

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Pick up where you left off.
        </p>
      </div>

      {expired ? <Alert tone="warning">{EXPIRED}</Alert> : null}
      {message ? <Alert tone="warning">{message}</Alert> : null}

      {current ? (
        <div className="space-y-3 rounded-[var(--radius)] border border-border bg-surface-muted/50 p-4">
          <p className="text-sm">
            You are already signed in as{' '}
            <span className="font-medium">{current.email}</span>.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={ROUTES.dashboard} className={buttonStyles({ size: 'sm' })}>
              Continue to your dashboard
            </Link>
            <span className="text-sm text-muted-foreground">
              or sign in as somebody else below.
            </span>
          </div>
        </div>
      ) : null}

      <LoginForm next={next || undefined} />

      <p className="text-sm text-muted-foreground">
        New here?{' '}
        <Link href={ROUTES.signup} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  )
}
