import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Plug, RefreshCw } from 'lucide-react'
import { DisconnectForm } from './disconnect-form'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { buttonStyles } from '@/components/ui/button'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import { availablePlatforms } from '@/lib/platforms'
import { connectMessage } from '@/lib/connections/messages'
import { PLATFORM_LABELS } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import { atLeast } from '@/lib/constants'

export const metadata: Metadata = { title: 'Connections' }

export default async function ConnectionsPage({
  searchParams,
}: PageProps<'/connections'>) {
  // Deliberately not `requireDashboard`: this is the page you come to when
  // there is nothing connected, so it cannot demand a live connection.
  const { active } = await requireWorkspace()
  const canManage = atLeast(active.role, 'admin')

  const supabase = await createClient()
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select(
      'id, platform, display_name, external_username, status, status_reason, paid_seat, connected_at',
    )
    .eq('workspace_id', active.workspace.id)
    .in('status', ['active', 'needs_reconnect'])
    .order('connected_at', { ascending: true })

  const connected = accounts ?? []
  const message = connectMessage((await searchParams).error)
  const platforms = availablePlatforms()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
          <p className="text-sm text-muted-foreground">
            The accounts this workspace can publish to.
          </p>
        </div>

        <Link
          href={ROUTES.connectTransfer}
          className={buttonStyles({ variant: 'ghost', size: 'sm' })}
        >
          Request a transfer
        </Link>
      </div>

      {message ? (
        <Alert tone={message.tone} title={message.title}>
          {message.body}
        </Alert>
      ) : null}

      {connected.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Nothing is connected yet. Scheduling and publishing stay locked until
            at least one account is live.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {connected.map((account) => {
            const name =
              account.display_name ?? account.external_username ?? 'Connected account'
            const healthy = account.status === 'active'

            return (
              <li
                key={account.id}
                className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-surface px-4 py-3"
              >
                {healthy ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                ) : (
                  <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {PLATFORM_LABELS[account.platform]}
                    {healthy ? null : ' · needs reconnecting'}
                    {/* Section 7.1: the billing unit is the connected account,
                        so whether this one is paid for decides if it can
                        publish or only hold drafts. */}
                    {account.paid_seat ? null : ' · unpaid, drafts only'}
                  </p>
                </div>

                {canManage ? (
                  <div className="flex items-center gap-1">
                    {healthy ? null : (
                      <a
                        href={`/api/connect/${account.platform}/start`}
                        className={buttonStyles({ variant: 'secondary', size: 'sm' })}
                      >
                        <RefreshCw className="size-3.5" aria-hidden />
                        Reconnect
                      </a>
                    )}
                    <DisconnectForm accountId={account.id} name={name} />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {canManage ? (
        <Card className="space-y-3">
          <p className="text-sm font-medium">Add an account</p>

          <div className="flex flex-wrap gap-2">
            {platforms.map((platform) => (
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
      ) : (
        <p className="text-sm text-muted-foreground">
          Only an owner or admin can change which accounts are connected.
        </p>
      )}
    </div>
  )
}
