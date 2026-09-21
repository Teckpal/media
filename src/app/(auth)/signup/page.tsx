import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignupForm } from './signup-form'
import { ROUTES } from '@/lib/routes'
import { getSessionUser } from '@/lib/auth/session'

export const metadata: Metadata = { title: 'Create your account' }

export default async function SignupPage() {
  if (await getSessionUser()) redirect(ROUTES.dashboard)

  // Vercel puts the visitor's country here (Section 7A.2, step 1).
  const country = (await headers()).get('x-vercel-ip-country')

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Connect your pages, plan the month, publish on time.
        </p>
      </div>

      <SignupForm country={country} />

      <p className="text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href={ROUTES.login} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
