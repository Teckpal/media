import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Picker, type Choice } from './picker'
import { Alert } from '@/components/ui/alert'
import { requireWorkspace } from '@/lib/auth/gate'
import { createAdminClient } from '@/lib/supabase/admin'
import { adapterFor, isSupported } from '@/lib/platforms'
import { decryptToken } from '@/lib/crypto/tokens'
import { ConnectError } from '@/lib/platforms/types'
import { PLATFORM_LABELS, atLeast } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Choose accounts' }

/**
 * Where the OAuth callback lands.
 *
 * The account list is fetched fresh from the platform on every render rather
 * than carried through the browser, so what the user ticks is what the platform
 * says exists — a form cannot offer an account the token does not cover.
 */
export default async function SelectAccountsPage({
  searchParams,
}: PageProps<'/connections/select'>) {
  const { user, active } = await requireWorkspace()

  if (!atLeast(active.role, 'admin')) {
    redirect(`${ROUTES.connections}?error=forbidden`)
  }

  const sessionId = (await searchParams).session
  if (typeof sessionId !== 'string') {
    redirect(`${ROUTES.connections}?error=invalid_state`)
  }

  // Service role: `oauth_sessions` has no RLS policy, because the row holds a
  // live platform token and must be unreachable from a browser.
  const admin = createAdminClient()
  const { data: session } = await admin
    .from('oauth_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle()

  if (
    !session ||
    session.user_id !== user.id ||
    session.workspace_id !== active.workspace.id ||
    session.consumed_at ||
    new Date(session.expires_at) < new Date()
  ) {
    redirect(`${ROUTES.connections}?error=invalid_state`)
  }

  if (!isSupported(session.platform)) {
    redirect(`${ROUTES.connections}?error=provider_error`)
  }

  const adapter = adapterFor(session.platform)
  if (!adapter) redirect(`${ROUTES.connections}?error=provider_error`)

  let discovered
  try {
    discovered = await adapter.listAccounts({
      accessToken: decryptToken(session.access_token_encrypted, 'oauth_session:v1'),
      scopes: session.granted_scopes,
    })
  } catch (cause) {
    const failure = cause instanceof ConnectError ? cause.failure : 'provider_error'
    redirect(`${ROUTES.connections}?error=${failure}`)
  }

  // Only this workspace's own live rows. A row held elsewhere is not shown as
  // "already connected" — that would leak the very thing Section 6.1 hides.
  // Those fail on submit instead, with the blocked wording.
  const { data: mine } = await admin
    .from('social_accounts')
    .select('external_account_id')
    .eq('workspace_id', active.workspace.id)
    .eq('platform', session.platform)
    .in('status', ['active', 'needs_reconnect'])

  const here = new Set((mine ?? []).map((row) => row.external_account_id))

  const choices: Choice[] = discovered.map((account) => ({
    externalAccountId: account.externalAccountId,
    displayName: account.displayName,
    username: account.username,
    avatarUrl: account.avatarUrl,
    accountType: account.accountType,
    alreadyHere: here.has(account.externalAccountId),
  }))

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Choose {PLATFORM_LABELS[session.platform]} accounts
        </h1>
        <p className="text-sm text-muted-foreground">
          Tick the ones this workspace should publish to.
        </p>
      </div>

      {choices.every((c) => c.alreadyHere) ? (
        <Alert tone="info" title="Everything here is already connected">
          There is nothing new to add from this account.
        </Alert>
      ) : null}

      <Picker sessionId={session.id} choices={choices} />
    </div>
  )
}
