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
import { PHASE_1_PLATFORMS, PLATFORM_LABELS } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Connect an account' }

/**
 * Section 6.1 gives each OAuth failure its own screen. Until Module 4 wires the
 * real flow, the branches arrive here as a query parameter so the copy — and in
 * particular the blocked-account wording — is settled now.
 */
const OAUTH_MESSAGES: Record<string, { tone: 'warning' | 'danger'; title: string; body: string }> = {
  cancelled: {
    tone: 'warning',
    title: 'That connection was cancelled',
    body: 'Nothing was changed. Try again when you are ready.',
  },
  wrong_account_type: {
    tone: 'warning',
    title: 'That account type will not work',
    body:
      'Instagram posting needs a Business or Creator account linked to a Facebook Page. Switch it in the Instagram app under Settings, then try again.',
  },
  missing_permissions: {
    tone: 'warning',
    title: 'Some permissions were not granted',
    body:
      'We need permission to read your pages and publish to them. Reconnect and leave every box ticked.',
  },
  already_connected: {
    tone: 'danger',
    title: 'This account is connected to another workspace',
    body:
      'An account can only live in one workspace at a time. If it belongs to you, contact support to request a transfer.',
  },
}

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

  const errorKey = (await searchParams).error
  const message = typeof errorKey === 'string' ? OAUTH_MESSAGES[errorKey] : undefined

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
          {PHASE_1_PLATFORMS.map((platform) => (
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
