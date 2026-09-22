import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { adapterFor } from '@/lib/platforms'
import { PublishError, type PublishRequest } from '@/lib/platforms/types'
import { accountTokenContext, decryptTokenOrNull } from '@/lib/crypto/tokens'
import { deactivateAccount } from '@/lib/connections/service'
import { canPublish, explainBlock } from '@/lib/billing/entitlements'
import { signPostMedia } from '@/lib/publish/media'
import { backoffMs } from '@/lib/publish/policy'
import {
  abandonTarget,
  claimDueTargets,
  notifyOutcome,
  reapStuckTargets,
  recordFailure,
  recordPublished,
  recordStillProcessing,
  type ClaimedTarget,
} from '@/lib/publish/queue'
import type { Platform } from '@/lib/constants'

/**
 * Section 4's publish worker, and Section 9's "Queue: due posts (every minute)".
 *
 * One tick: reap what was abandoned, claim what is due, send it, write down
 * what happened. Everything it touches it claimed first, so two ticks running
 * at once — which Vercel permits, and which the publish-now path causes on
 * purpose — divide the work rather than duplicate it.
 *
 * The order inside a single target is deliberate and is worth reading as a
 * list of everything that can have changed since the post was scheduled:
 * the account may be gone, the plan may have lapsed, the media may have been
 * deleted, the token may have been revoked. Each is checked before anything is
 * sent, because a post that cannot go out should say so rather than half-try.
 */

/** How many targets one invocation will take on. */
const DEFAULT_BATCH = 20

/**
 * How long we will keep coming back to a post the platform is still
 * processing.
 *
 * Waiting costs no attempt — that is the point of it — which means without a
 * clock a container Meta never finishes would be picked up, waited on and put
 * back every minute for ever. Half an hour is far longer than a Reel takes and
 * short enough that a stuck post is reported the same morning.
 */
const PROCESSING_DEADLINE_MS = 30 * 60_000

export type TickSummary = {
  reaped: number
  claimed: number
  published: number
  failed: number
  retrying: number
  processing: number
}

export async function runPublishTick(
  options: { limit?: number } = {},
): Promise<TickSummary> {
  const summary: TickSummary = {
    reaped: await reapStuckTargets(),
    claimed: 0,
    published: 0,
    failed: 0,
    retrying: 0,
    processing: 0,
  }

  const claimed = await claimDueTargets(options.limit ?? DEFAULT_BATCH)
  summary.claimed = claimed.length

  // Sequentially. Publishing is I/O-bound and parallelism would be tempting,
  // but several targets often belong to one Page, and Meta rate-limits per
  // Page — so a parallel batch mostly buys 429s. The tick is a minute long and
  // the next one picks up whatever is left.
  for (const target of claimed) {
    try {
      const outcome = await publishTarget(target)
      summary[outcome] += 1
    } catch (cause) {
      // A bug in here must not leave the target claimed until its lease runs
      // out — that would lock the post for five minutes for nothing.
      console.error('[publish] unhandled error on target %s: %s', target.id, String(cause))
      await recordFailure(target, {
        facts: { retryable: true, safeToRepeat: false },
        message: 'Something went wrong on our side while publishing this post.',
        detail: String(cause),
      })
      summary.failed += 1
    }
  }

  return summary
}

type TargetOutcome = 'published' | 'failed' | 'retrying' | 'processing'

async function publishTarget(target: ClaimedTarget): Promise<TargetOutcome> {
  const admin = createAdminClient()

  const { data: post } = await admin
    .from('posts')
    .select('id, workspace_id, status, caption, media_ids, scheduled_at')
    .eq('id', target.post_id)
    .maybeSingle()

  if (!post) {
    await abandonTarget(target, 'The post no longer exists.')
    return 'failed'
  }

  // The claim moved it to `publishing`. Anything else means something
  // unexpected has happened to it since, and the safe reading of "unexpected"
  // is to stop rather than to publish.
  if (post.status !== 'publishing') {
    await abandonTarget(target, 'This post was no longer ready to publish.')
    return 'failed'
  }

  const { data: account } = await admin
    .from('social_accounts')
    .select('*')
    .eq('id', target.social_account_id)
    .maybeSingle()

  if (!account) {
    await abandonTarget(target, 'That account is no longer connected.')
    return 'failed'
  }

  const accountName = account.display_name ?? account.external_username ?? 'that account'

  if (account.status !== 'active') {
    // Section 6.1: a connection that needs reconnecting cannot publish.
    await abandonTarget(
      target,
      `${accountName} needs reconnecting before anything can be published to it.`,
    )
    await notifyOutcome({
      workspaceId: post.workspace_id,
      postId: post.id,
      platform: target.platform as Platform,
      accountName,
      published: false,
      error: `${accountName} needs reconnecting.`,
    })
    return 'failed'
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('id, is_billing_exempt')
    .eq('id', post.workspace_id)
    .maybeSingle()

  if (!workspace) {
    await abandonTarget(target, 'That workspace no longer exists.')
    return 'failed'
  }

  // Gate 2, again, at the moment of publishing rather than the moment of
  // scheduling. A post can sit in the calendar for weeks, and a plan that
  // lapsed in between must not publish on its last day's terms.
  //
  // It fails rather than pausing because the post is already `publishing`, and
  // Section 6.2's state machine has no way back from there. `failed` is a state
  // the user can reschedule out of once they have sorted the plan out.
  const entitlement = await canPublish(workspace, [account.id], { client: admin })
  if (!entitlement.allowed) {
    const reason = explainBlock(entitlement.block)
    await abandonTarget(target, reason)
    await notifyOutcome({
      workspaceId: post.workspace_id,
      postId: post.id,
      platform: target.platform as Platform,
      accountName,
      published: false,
      error: reason,
    })
    return 'failed'
  }

  const adapter = adapterFor(target.platform as Platform)
  if (!adapter) {
    await abandonTarget(target, 'That platform is not connected to publishing yet.')
    return 'failed'
  }

  const token = decryptTokenOrNull(
    account.access_token_encrypted,
    accountTokenContext(
      account.workspace_id,
      account.platform,
      account.external_account_id,
    ),
  )

  if (!token) {
    // The ciphertext will not open — a rotated key, or a row whose token was
    // written for a different account. There is nothing to publish with, and
    // the only cure is reconnecting.
    await handleLostAccess(post.workspace_id, account.id, 'token_unreadable')
    await abandonTarget(
      target,
      `We lost access to ${accountName}. Reconnect it and schedule this again.`,
    )
    return 'failed'
  }

  const media = await signPostMedia(post.workspace_id, post.media_ids)
  if (!media.ok) {
    await abandonTarget(target, media.reason)
    await notifyOutcome({
      workspaceId: post.workspace_id,
      postId: post.id,
      platform: target.platform as Platform,
      accountName,
      published: false,
      error: media.reason,
    })
    return 'failed'
  }

  const request: PublishRequest = {
    externalAccountId: account.external_account_id,
    accessToken: token,
    caption: post.caption,
    media: media.media,
    idempotencyKey: target.idempotency_key,
    containerId: target.external_container_id,
  }

  // Nothing published before the post's own scheduled time can be this post,
  // which makes that the natural floor for "did an earlier attempt land?".
  // A publish-now post carries a scheduled_at too, so this is always set; the
  // target's creation time is the fallback rather than an assumption of "now",
  // which would look past the very attempt we are asking about.
  const sentNoEarlierThan = new Date(post.scheduled_at ?? target.created_at)

  // A second or later attempt: before sending anything, check whether the
  // previous one actually worked. Section 6.2 treats a double publish as the
  // serious failure, and Meta gives us no idempotency key to prevent one.
  if (target.attempts > 1) {
    const already = await adapter.findRecentlyPublished(request, sentNoEarlierThan)
    if (already) {
      await recordPublished(target, already)
      await notifyOutcome({
        workspaceId: post.workspace_id,
        postId: post.id,
        platform: target.platform as Platform,
        accountName,
        published: true,
      })
      return 'published'
    }
  }

  try {
    const result = await adapter.publish(request)

    await recordPublished(target, result)
    await notifyOutcome({
      workspaceId: post.workspace_id,
      postId: post.id,
      platform: target.platform as Platform,
      accountName,
      published: true,
    })
    return 'published'
  } catch (cause) {
    const error =
      cause instanceof PublishError
        ? cause
        : new PublishError('Something went wrong while publishing this post.', {
            retryable: true,
            ambiguous: true,
            detail: String(cause),
          })

    // Still being processed by the platform. Not a failure: the attempt is
    // handed back and the container is kept, so the next tick resumes it.
    if (error.stillProcessing) {
      if (Date.now() - sentNoEarlierThan.getTime() > PROCESSING_DEADLINE_MS) {
        const reason =
          'The platform never finished processing this post. Try again, or upload a smaller file.'

        await abandonTarget(target, reason)
        await notifyOutcome({
          workspaceId: post.workspace_id,
          postId: post.id,
          platform: target.platform as Platform,
          accountName,
          published: false,
          error: reason,
        })
        return 'failed'
      }

      await recordStillProcessing(
        target,
        error.containerId ?? null,
        new Date(Date.now() + backoffMs(1)),
      )
      return 'processing'
    }

    // A revoked token is the platform telling us the connection is over.
    // Section 6.1 wants that reflected on the connection itself, not just on
    // this one post.
    if (isLostAccess(error)) {
      await handleLostAccess(post.workspace_id, account.id, 'publish_unauthorised')
    }

    // The send may have landed. Before deciding whether to try again, go and
    // look — and if we cannot tell, do not repeat it.
    let safeToRepeat = true
    if (error.ambiguous) {
      const already = await adapter.findRecentlyPublished(request, sentNoEarlierThan)

      if (already) {
        await recordPublished(target, already)
        await notifyOutcome({
          workspaceId: post.workspace_id,
          postId: post.id,
          platform: target.platform as Platform,
          accountName,
          published: true,
        })
        return 'published'
      }

      safeToRepeat = false
    }

    const willRetry = await recordFailure(target, {
      facts: { retryable: error.retryable, safeToRepeat },
      message: error.userMessage,
      detail: error.detail,
      containerId: error.containerId,
    })

    if (willRetry) return 'retrying'

    await notifyOutcome({
      workspaceId: post.workspace_id,
      postId: post.id,
      platform: target.platform as Platform,
      accountName,
      published: false,
      error: error.userMessage,
    })
    return 'failed'
  }
}

/** Meta's way of saying the grant is gone. */
function isLostAccess(error: PublishError): boolean {
  return /\[190\]|\[200\]|\[10\]/.test(error.detail ?? '')
}

/**
 * Drops the connection to `needs_reconnect` and pauses what else it was going
 * to publish — the same path the token-refresh cron uses, so a revocation
 * discovered at publish time is handled exactly like one discovered in advance.
 */
async function handleLostAccess(
  workspaceId: string,
  accountId: string,
  reason: string,
): Promise<void> {
  await deactivateAccount({
    accountId,
    workspaceId,
    actorId: null,
    status: 'needs_reconnect',
    reason,
    source: 'system',
  })

  await createAdminClient().from('notifications').insert({
    workspace_id: workspaceId,
    user_id: null,
    kind: 'needs_reconnect',
    title: 'An account needs reconnecting',
    body: 'We lost access to one of your accounts while publishing. Reconnect it to keep posting.',
    link_path: '/connections',
    data: { social_account_id: accountId, reason },
  })

  // Deactivation cancels that account's *pending* targets. The one being
  // published is not pending, so the caller still has to settle it — which it
  // does, on the line after this returns.
}
