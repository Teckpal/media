'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth/session'
import { claimAccount, deactivateAccount } from '@/lib/connections/service'
import { adapterFor, isSupported } from '@/lib/platforms'
import { decryptToken } from '@/lib/crypto/tokens'
import { ROUTES } from '@/lib/routes'
import type { FormState } from '@/lib/forms'
import type { WorkspaceRoleEnum } from '@/types/database'

/**
 * Connections are an admin action (Section 6.3): an editor writes posts, an
 * admin decides which accounts exist. Every action here starts by proving that
 * server-side rather than trusting the screen it was called from.
 */
async function requireAdmin(): Promise<{
  userId: string
  workspaceId: string
  role: WorkspaceRoleEnum
}> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  const supabase = await createClient()
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    redirect(`${ROUTES.connections}?error=forbidden`)
  }

  return { userId: user.id, workspaceId, role: membership.role }
}

// --- connect the chosen accounts --------------------------------------------

export async function connectSelectedAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId, workspaceId } = await requireAdmin()

  const sessionId = z.string().uuid().safeParse(formData.get('session'))
  if (!sessionId.success) {
    return { error: 'That connection attempt has expired. Start again.' }
  }

  const chosen = formData.getAll('account').map(String).filter(Boolean)
  if (chosen.length === 0) {
    return { error: 'Choose at least one account to connect.' }
  }

  const admin = createAdminClient()
  const { data: session } = await admin
    .from('oauth_sessions')
    .select('*')
    .eq('id', sessionId.data)
    .maybeSingle()

  // The session belongs to one user and one workspace, and is single-use.
  // Checked here rather than relying on the id being unguessable.
  if (
    !session ||
    session.user_id !== userId ||
    session.workspace_id !== workspaceId ||
    session.consumed_at ||
    new Date(session.expires_at) < new Date()
  ) {
    return { error: 'That connection attempt has expired. Start again.' }
  }

  if (!isSupported(session.platform)) {
    return { error: 'That platform is not available yet.' }
  }

  const adapter = adapterFor(session.platform)
  if (!adapter) return { error: 'That platform is not available yet.' }

  let discovered
  try {
    // Re-fetched rather than carried through the browser, so the tokens that
    // get stored are the platform's own and not anything a form could forge.
    discovered = await adapter.listAccounts({
      accessToken: decryptToken(session.access_token_encrypted, 'oauth_session:v1'),
      scopes: session.granted_scopes,
    })
  } catch {
    return { error: 'Could not read your accounts. Try connecting again.' }
  }

  const wanted = new Set(chosen)
  const selected = discovered.filter((a) => wanted.has(a.externalAccountId))

  if (selected.length === 0) {
    return { error: 'Those accounts are no longer available. Try connecting again.' }
  }

  const blocked: string[] = []
  let connected = 0

  for (const account of selected) {
    const result = await claimAccount({
      workspaceId,
      userId,
      platform: session.platform,
      account,
    })

    if (result.outcome === 'blocked') blocked.push(account.displayName)
    else if (result.outcome === 'error') blocked.push(account.displayName)
    else connected += 1
  }

  // Single-use: spent whether or not every account went through, so the token
  // inside it cannot be reused.
  await admin
    .from('oauth_sessions')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', session.id)

  revalidatePath(ROUTES.connections)

  if (connected === 0) {
    // Section 6.1: name the account the user chose, never the workspace that
    // holds it or who owns it.
    return {
      error:
        blocked.length === 1
          ? `${blocked[0]} is already connected to another workspace.`
          : 'Those accounts are already connected to another workspace.',
    }
  }

  if (blocked.length > 0) {
    return {
      error: null,
      notice:
        `Connected ${connected}. ` +
        `${blocked.join(', ')} could not be added — already connected to another workspace.`,
    }
  }

  redirect(ROUTES.connections)
}

// --- disconnect ---------------------------------------------------------------

export async function disconnectAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId, workspaceId } = await requireAdmin()

  const accountId = z.string().uuid().safeParse(formData.get('accountId'))
  if (!accountId.success) return { error: 'Unknown account.' }

  // Scoped to this workspace, so an id belonging to someone else's account
  // matches nothing.
  const supabase = await createClient()
  const { data: account } = await supabase
    .from('social_accounts')
    .select('id, display_name')
    .eq('id', accountId.data)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (!account) return { error: 'Unknown account.' }

  const { pausedPosts } = await deactivateAccount({
    accountId: account.id,
    workspaceId,
    actorId: userId,
    status: 'disconnected',
    reason: 'disconnected_by_user',
  })

  revalidatePath(ROUTES.connections)

  return {
    error: null,
    notice:
      pausedPosts > 0
        ? `Disconnected. ${pausedPosts} scheduled ${pausedPosts === 1 ? 'post was' : 'posts were'} paused.`
        : 'Disconnected. Your drafts are untouched.',
  }
}

// --- transfer request (Section 6.1) -------------------------------------------

const transferSchema = z.object({
  platform: z.string().min(1),
  externalAccountId: z.string().trim().min(1, 'Enter the account id or handle.').max(200),
  evidence: z
    .string()
    .trim()
    .min(20, 'Tell us a little more, so support can check it.')
    .max(4000),
})

/**
 * Section 6.1: the real owner is locked out because an old agency still holds
 * the page, or a client has left MOTiF and signed up on their own.
 *
 * All this does is open a case. The decision rests on a platform-side admin
 * check performed by support — nothing here moves an account, and the requester
 * is never told which workspace currently holds it.
 */
export async function requestTransferAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { userId, workspaceId } = await requireAdmin()

  const parsed = transferSchema.safeParse({
    platform: formData.get('platform'),
    externalAccountId: formData.get('externalAccountId'),
    evidence: formData.get('evidence'),
  })

  if (!parsed.success) {
    return {
      error: 'Check the fields below.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message]),
      ),
    }
  }

  if (!isSupported(parsed.data.platform)) {
    return { error: 'That platform is not available yet.' }
  }

  const admin = createAdminClient()

  // Resolved server-side and stored on the row for support. The column is
  // revoked from client reads in migration 0008, so filling it in here does
  // not leak it back to the requester.
  const { data: holder } = await admin
    .from('social_accounts')
    .select('workspace_id')
    .eq('platform', parsed.data.platform)
    .eq('external_account_id', parsed.data.externalAccountId)
    .in('status', ['active', 'needs_reconnect'])
    .maybeSingle()

  if (holder?.workspace_id === workspaceId) {
    return { error: 'That account is already connected to this workspace.' }
  }

  const { error } = await admin.from('account_transfer_requests').insert({
    platform: parsed.data.platform,
    external_account_id: parsed.data.externalAccountId,
    from_workspace_id: holder?.workspace_id ?? null,
    to_workspace_id: workspaceId,
    requested_by: userId,
    evidence: parsed.data.evidence,
  })

  if (error) {
    // The partial unique index allows one open request per account per claimant.
    if (error.code === '23505') {
      return { error: 'You already have a request open for that account.' }
    }
    return { error: 'Could not submit that request. Try again.' }
  }

  await admin.from('audit_log').insert({
    workspace_id: workspaceId,
    actor_id: userId,
    action: 'transfer.requested',
    entity_type: 'social_account_external',
    entity_id: `${parsed.data.platform}:${parsed.data.externalAccountId}`,
    source: 'web',
    detail: { platform: parsed.data.platform },
  })

  return {
    error: null,
    notice:
      'Request submitted. Support will check ownership with the platform and be in touch.',
  }
}
