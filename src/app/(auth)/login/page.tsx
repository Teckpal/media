import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LoginForm } from './login-form'
import { Alert } from '@/components/ui/alert'
import { ROUTES } from '@/lib/routes'
import { getSessionUser } from '@/lib/auth/session'

export const metadata: Metadata = { title: 'Sign in' }

const ERRORS: Record<string, string> = {
  missing_code: 'That link was incomplete. Sign in below.',
  exchange_failed: 'That link has already been used or has expired.',
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  // A signed-in visitor asking for the login page is handed to the router gate
  // instead, which knows where they actually belong (Section 4).
  if (await getSessionUser()) redirect(ROUTES.dashboard)

  const error = (await searchParams).error
  const message = typeof error === 'string' ? ERRORS[error] : undefined

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Pick up where you left off.
        </p>
      </div>

      {message ? <Alert tone="warning">{message}</Alert> : null}

      <LoginForm />

      <p className="text-sm text-muted-foreground">
        New here?{' '}
        <Link href={ROUTES.signup} className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  )
}
