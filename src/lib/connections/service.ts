import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { accountTokenContext, encryptToken } from '@/lib/crypto/tokens'
import type { DiscoveredAccount } from '@/lib/platforms/types'
import { PLATFORM_LABELS, type Platform } from '@/lib/constants'
import { announce } from '@/lib/notifications/announce'
import { ROUTES } from '@/lib/routes'

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505'

export type ClaimResult =
  | { outcome: 'connected'; accountId: string }
  | { outcome: 'reconnected'; accountId: string }
  /** Live in some other workspace. Which one is never disclosed (Section 6.1). */
  | { outcome: 'blocked' }
  | { outcome: 'error'; detail: string }

/**
 * Claims one discovered account for a workspace.
 *
 * Decision #7 and Section 6.1: a live social account belongs to exactly one
 * workspace. The rule is a partial unique index in the database covering only
 * `active` and `needs_reconnect`, which means:
 *
 *   - our own disconnected row is reused rather than duplicated;
 *   - a row live elsewhere makes the insert fail, and we report `blocked`
 *     without ever reading who holds it;
 *   - two users racing on the same account at the same second resolve cleanly,
 *     because the loser is rejected by the index rather than by a check that
 *     ran a moment earlier.
 *
 * That last point is why this does not "look first, then insert". A read
 * followed by a write has a gap; the constraint does not.
 */
export async function claimAccount(params: {
  workspaceId: string
  userId: string
  platform: Platform
  account: DiscoveredAccount
}): Promise<ClaimResult> {
  const { workspaceId, userId, platform, account } = params
  const admin = createAdminClient()

  const context = accountTokenContext(workspaceId, platform, account.externalAccountId)

  const tokenFields = {
    access_token_encrypted: encryptToken(account.accessToken, context),
    refresh_token_encrypted: account.refreshToken
      ? encryptToken(account.refreshToken, context)
      : null,
    token_expires_at: account.expiresAt?.toISOString() ?? null,
    scopes: account.scopes,
  }

  const descriptiveFields = {
    external_username: account.username ?? null,
    display_name: account.displayName,
    avatar_url: account.avatarUrl ?? null,
    account_type: account.accountType,
    parent_external_id: account.parentExternalId ?? null,
  }

  // A row this workspace already owns — perhaps disconnected earlier, perhaps
  // sitting in needs_reconnect. Reviving it keeps the history and the billing
  // seat attached to the same row.
  const { data: existing } = await admin
    .from('social_accounts')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .eq('platform', platform)
    .eq('external_account_id', account.externalAccountId)
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const { error } = await admin
      .from('social_accounts')
      .update({
        ...tokenFields,
        ...descriptiveFields,
        status: 'active',
        status_reason: null,
        connected_by: userId,
        connected_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (error) {
      // Revival can still lose the race: the account may have gone live in
      // another workspace while this one sat disconnected.
      if (error.code === UNIQUE_VIOLATION) return { outcome: 'blocked' }
      return { outcome: 'error', detail: error.message }
    }

    return {
      outcome: existing.status === 'active' ? 'connected' : 'reconnected',
      accountId: existing.id,
    }
  }

  const { data: created, error } = await admin
    .from('social_accounts')
    .insert({
      workspace_id: workspaceId,
      platform,
      external_account_id: account.externalAccountId,
      // Who connected it, in the platform's own terms. The only thing a
      // provider-initiated deletion request can be matched against.
      connected_external_user_id: account.connectedExternalUserId ?? null,
      ...descriptiveFields,
      ...tokenFields,
      status: 'active',
      connected_by: userId,
      // Section 7.1 bills per connected account. A new connection starts
      // unpaid; the publish gate is what turns that into "drafts only" until a
      // seat is paid for.
      paid_seat: false,
      last_synced_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { outcome: 'blocked' }
    return { outcome: 'error', detail: error.message }
  }

  await admin.from('audit_log').insert({
    workspace_id: workspaceId,
    actor_id: userId,
    action: 'connection.connected',
    entity_type: 'social_account',
    entity_id: created.id,
    source: 'web',
    detail: { platform, external_account_id: account.externalAccountId },
  })

  await announce({
    workspaceId,
    actorId: userId,
    kind: 'account_connected',
    title: `${PLATFORM_LABELS[platform]} connected`,
    body: `${account.displayName} can now be published to.`,
    linkPath: ROUTES.connections,
    detail: { platform, social_account_id: created.id },
  })

  return { outcome: 'connected', accountId: created.id }
}

/**
 * Takes a connection out of service.
 *
 * Section 6.1: "User disconnects an account -> scheduled posts paused, billing
 * seat freed next cycle." Section 7.2 is the other half of that — the seat
 * stays paid until the cycle ends, so `seat_paid_until` is left alone and the
 * next invoice is simply smaller.
 *
 * `reason` separates a user disconnecting from the token-refresh cron giving
 * up, which land in different statuses and different notifications.
 */
export async function deactivateAccount(params: {
  accountId: string
  workspaceId: string
  actorId: string | null
  status: 'disconnected' | 'needs_reconnect'
  reason: string
  source?: string
}): Promise<{ pausedPosts: number }> {
  const { accountId, workspaceId, actorId, status, reason } = params
  const admin = createAdminClient()

  const { data: account } = await admin
    .from('social_accounts')
    .update({ status, status_reason: reason })
    .eq('id', accountId)
    .select('platform, account_name')
    .maybeSingle<{ platform: Platform; account_name: string }>()

  const pausedPosts = await pauseSchedulesFor(accountId)

  await admin.from('audit_log').insert({
    workspace_id: workspaceId,
    actor_id: actorId,
    action: status === 'disconnected' ? 'connection.disconnected' : 'connection.needs_reconnect',
    entity_type: 'social_account',
    entity_id: accountId,
    source: params.source ?? 'web',
    detail: { reason, paused_posts: pausedPosts },
  })

  // Only the deliberate case. `needs_reconnect` already produces its own, more
  // useful notification where it is detected — in the token refresher and in
  // the publish worker, which know what broke. Announcing here as well would
  // put two rows on the bell for one event.
  if (status === 'disconnected') {
    await announce({
      workspaceId,
      actorId,
      kind: 'account_disconnected',
      title: `${account ? PLATFORM_LABELS[account.platform] : 'An account'} was disconnected`,
      body:
        pausedPosts > 0
          ? `${account?.account_name ?? 'The account'} is no longer connected. ${pausedPosts} scheduled ${
              pausedPosts === 1 ? 'post is' : 'posts are'
            } paused.`
          : `${account?.account_name ?? 'The account'} is no longer connected.`,
      linkPath: ROUTES.connections,
      detail: { social_account_id: accountId, paused_posts: pausedPosts },
    })
  }

  return { pausedPosts }
}

/**
 * Pauses what this account was about to publish.
 *
 * A post can fan out to several accounts, so the account's own targets are
 * cancelled first and the post is paused only when nothing publishable is left
 * — otherwise disconnecting Instagram would silently stop a post that was also
 * going to Facebook.
 *
 * Posts already in `publishing` are left alone. Section 6.2 locks them, and the
 * database trigger would refuse the write anyway.
 */
async function pauseSchedulesFor(accountId: string): Promise<number> {
  const admin = createAdminClient()

  const { data: targets } = await admin
    .from('post_targets')
    .select('id, post_id, status')
    .eq('social_account_id', accountId)
    .eq('status', 'pending')

  if (!targets || targets.length === 0) return 0

  await admin
    .from('post_targets')
    .update({ status: 'cancelled' })
    .in(
      'id',
      targets.map((t) => t.id),
    )

  const postIds = [...new Set(targets.map((t) => t.post_id))]
  let paused = 0

  for (const postId of postIds) {
    const { count } = await admin
      .from('post_targets')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', postId)
      .in('status', ['pending', 'publishing'])

    if ((count ?? 0) > 0) continue

    const { error } = await admin
      .from('posts')
      .update({ status: 'paused' })
      .eq('id', postId)
      .eq('status', 'scheduled')

    if (!error) paused += 1
  }

  return paused
}
