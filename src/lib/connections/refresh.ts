import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { adapterFor } from '@/lib/platforms'
import {
  accountTokenContext,
  decryptTokenOrNull,
  encryptToken,
} from '@/lib/crypto/tokens'
import { deactivateAccount } from '@/lib/connections/service'
import type { Platform } from '@/lib/constants'

/**
 * Section 9: "Token refresh: cron every few hours."
 *
 * The window matters. Meta has no refresh token — a long-lived user token is
 * traded for a fresh one while the old one is *still valid*. Let it lapse and
 * there is nothing to trade, and the user has to reconnect by hand. So the
 * sweep starts a week out, which gives roughly 28 chances to succeed at a
 * six-hourly cadence before anyone is inconvenienced.
 */
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export type RefreshSummary = {
  examined: number
  refreshed: number
  needsReconnect: number
  failed: number
}

export async function refreshExpiringTokens(
  now = new Date(),
): Promise<RefreshSummary> {
  const admin = createAdminClient()
  const horizon = new Date(now.getTime() + REFRESH_WINDOW_MS)

  const { data: accounts } = await admin
    .from('social_accounts')
    .select('*')
    .eq('status', 'active')
    .not('token_expires_at', 'is', null)
    .lt('token_expires_at', horizon.toISOString())
    .limit(200)

  const summary: RefreshSummary = {
    examined: accounts?.length ?? 0,
    refreshed: 0,
    needsReconnect: 0,
    failed: 0,
  }

  for (const account of accounts ?? []) {
    const adapter = adapterFor(account.platform as Platform)
    if (!adapter) continue

    const context = accountTokenContext(
      account.workspace_id,
      account.platform,
      account.external_account_id,
    )

    const accessToken = decryptTokenOrNull(account.access_token_encrypted, context)

    if (!accessToken) {
      // The ciphertext will not open: a rotated key, or a row whose token was
      // written for a different account. Either way there is nothing to
      // refresh, and pretending otherwise would fail at publish time instead.
      await markNeedsReconnect(account.id, account.workspace_id, 'token_unreadable')
      summary.needsReconnect += 1
      continue
    }

    try {
      const refreshed = await adapter.refresh({
        accessToken,
        refreshToken:
          decryptTokenOrNull(account.refresh_token_encrypted, context) ?? undefined,
        scopes: account.scopes ?? [],
      })

      if (!refreshed) {
        await markNeedsReconnect(account.id, account.workspace_id, 'no_refresh_available')
        summary.needsReconnect += 1
        continue
      }

      await admin
        .from('social_accounts')
        .update({
          access_token_encrypted: encryptToken(refreshed.accessToken, context),
          refresh_token_encrypted: refreshed.refreshToken
            ? encryptToken(refreshed.refreshToken, context)
            : account.refresh_token_encrypted,
          token_expires_at: refreshed.expiresAt?.toISOString() ?? null,
          last_synced_at: now.toISOString(),
        })
        .eq('id', account.id)

      summary.refreshed += 1
    } catch (cause) {
      // Section 6.1: "Token refresh fails / access revoked on the platform ->
      // status needs_reconnect, posts for it paused, notify."
      //
      // No retry here. A refusal from the platform means access was revoked or
      // the grant expired, and hammering it changes nothing — the user has to
      // reconnect. The notification is what moves this along.
      await markNeedsReconnect(
        account.id,
        account.workspace_id,
        'token_refresh_failed',
      )
      summary.needsReconnect += 1

      console.error(
        '[refresh] %s account %s: %s',
        account.platform,
        account.id,
        cause instanceof Error ? cause.message : String(cause),
      )
    }
  }

  return summary
}

/**
 * Drops the connection to `needs_reconnect` and pauses what it was going to
 * publish, then queues the notification that tells someone about it.
 */
async function markNeedsReconnect(
  accountId: string,
  workspaceId: string,
  reason: string,
): Promise<void> {
  const { pausedPosts } = await deactivateAccount({
    accountId,
    workspaceId,
    actorId: null,
    status: 'needs_reconnect',
    reason,
    source: 'system',
  })

  const admin = createAdminClient()
  await admin.from('notifications').insert({
    workspace_id: workspaceId,
    // Workspace-wide: whoever can fix it should see it, and the person who
    // originally connected the account may have left (Section 6.3).
    user_id: null,
    kind: 'needs_reconnect',
    title: 'An account needs reconnecting',
    body:
      pausedPosts > 0
        ? `We lost access to one of your accounts. ${pausedPosts} scheduled ${
            pausedPosts === 1 ? 'post is' : 'posts are'
          } paused until it is reconnected.`
        : 'We lost access to one of your accounts. Reconnect it to keep publishing.',
    link_path: '/connections',
    data: { social_account_id: accountId, reason },
  })
}
