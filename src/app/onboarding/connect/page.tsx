import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Plug } from 'lucide-react'
import { ContinueButton } from './continue-button'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { buttonStyles } from '@/components/ui/button'
import { guardOnboardingStep, requireVerifiedUser } from '@/lib/auth/gate'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import { createClient } from '@/lib/supabase/server'
import { PLATFORM_LABELS } from '@/lib/constants'
import { availablePlatforms } from '@/lib/platforms'
import { connectMessage } from '@/lib/connections/messages'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Connect an account' }

export default async function ConnectPage({ searchParams }: PageProps<'/onboarding/connect'>) {
  const user = await requireVerifiedUser()
  guardOnboardingStep(user, 'connect', STEP_ORDER)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  const supabase = await createClient()
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('id, platform, display_name, external_username, status')
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'needs_reconnect'])
    .order('connected_at', { ascending: true })

  const connected = accounts ?? []
  const hasActive = connected.some((a) => a.status === 'active')

  // Same copy as the Connections page, from one place — including the blocked
  // wording, which names no workspace and no owner (Section 6.1).
  const message = connectMessage((await searchParams).error)

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Connect an account</h1>
        <p className="text-sm text-muted-foreground">
          At least one, to carry on. This is the step that makes everything else
          possible, so there is no way past it — but your progress is saved if
          you need to come back.
        </p>
      </div>

      {message ? (
        <Alert tone={message.tone} title={message.title}>
          {message.body}
        </Alert>
      ) : null}

      {connected.length > 0 ? (
        <ul className="space-y-2">
          {connected.map((account) => (
            <li
              key={account.id}
              className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-surface px-4 py-3"
            >
              {account.status === 'active' ? (
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {account.display_name ?? account.external_username ?? 'Connected account'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {PLATFORM_LABELS[account.platform]}
                  {account.status === 'needs_reconnect' ? ' · needs reconnecting' : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Card className="space-y-3">
        <p className="text-sm font-medium">Add an account</p>

        <div className="flex flex-wrap gap-2">
          {availablePlatforms().map((platform) => (
            <a
              key={platform}
              href={`/api/connect/${platform}/start`}
              className={buttonStyles({ variant: 'secondary' })}
            >
              <Plug className="size-4" aria-hidden />
              {PLATFORM_LABELS[platform]}
            </a>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          LinkedIn and YouTube follow, then TikTok and X.
        </p>
      </Card>

      <ContinueButton enabled={hasActive} />
    </div>
  )
}
