import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Button, buttonStyles } from '@/components/ui/button'
import { Wordmark } from '@/components/brand/wordmark'
import { ROUTES } from '@/lib/routes'
import { evaluateGate, requireVerifiedUser } from '@/lib/auth/gate'
import { signOutAction } from '@/lib/auth/actions'

export const metadata: Metadata = { title: 'Reconnect an account' }

/**
 * Where the router gate sends a workspace with no live connection
 * (Section 4, and Section 6.1 "Last account disconnected").
 *
 * It sits outside the (app) group on purpose: the gate that protects that
 * group is the very thing that redirects here, so living inside it would loop.
 */
export default async function ReconnectPage() {
  await requireVerifiedUser()

  // If a connection came back while the user was on this page, there is nothing
  // to do here any more.
  const verdict = await evaluateGate()
  if (verdict.kind === 'ok') redirect(ROUTES.dashboard)
  if (verdict.kind !== 'no_active_connection') redirect(verdict.redirectTo)

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
      <Wordmark className="mb-8" />

      <Card className="space-y-5">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            Reconnect to keep publishing
          </h1>
          <p className="text-sm text-muted-foreground">
            None of this workspace&rsquo;s social accounts are live right now. That
            happens when access is revoked on the platform, or when a token
            expires and cannot be refreshed.
          </p>
        </div>

        <Alert tone="warning" title="What this affects">
          Scheduled posts for the affected accounts are paused, and nothing new
          can be scheduled. Your drafts, your calendar and your settings are
          untouched.
        </Alert>

        <Link href={ROUTES.connections} className={buttonStyles({ fullWidth: true })}>
          Go to Connections
        </Link>

        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm" fullWidth>
            Sign out
          </Button>
        </form>
      </Card>
    </div>
  )
}
