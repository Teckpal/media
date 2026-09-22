import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { decideAfterFailure, explainGivingUp, type FailureFacts } from '@/lib/publish/policy'
import { MAX_PUBLISH_ATTEMPTS, PLATFORM_LABELS, type Platform } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import type { PostTargetRow } from '@/types/database'

/**
 * Everything the publish worker does to the database.
 *
 * Kept apart from `worker.ts` so that the part which talks to Meta and the part
 * which records what happened can be read — and worried about — separately.
 *
 * All of it runs with the service role, which skips RLS but not triggers: the
 * post state machine, the publishing lock and the schedule guard all still
 * apply, and are what stop a bug here from writing a state the rest of the app
 * does not believe in.
 */

/** How long a claim is good for before another worker may take the target. */
const LEASE_SECONDS = 300

export type ClaimedTarget = PostTargetRow

/**
 * Fails targets whose worker never came back and whose attempts are spent.
 *
 * Without it their post stays `publishing`, and a publishing post is locked
 * against every edit, pause and delete (Section 6.2) — so the user would be
 * left with a post they cannot touch and we are no longer working on.
 */
/** `null` means the query did not run — which is not the same as "nothing to reap". */
export async function reapStuckTargets(): Promise<number | null> {
  const { data, error } = await createAdminClient().rpc('reap_stuck_targets', {
    max_attempts: MAX_PUBLISH_ATTEMPTS,
  })

  if (error) {
    console.error('[publish] reap failed: %s', error.message)
    return null
  }

  return data ?? 0
}

/**
 * Takes a batch of due targets for this worker.
 *
 * The claim is a single statement in Postgres (`claim_due_targets`, migration
 * 0012) using `for update ... skip locked`, so two ticks running at once take
 * disjoint batches instead of both publishing the same post.
 */
/**
 * `null` means the claim did not run. An empty array means it ran and there was
 * nothing due — the worker has to tell those apart, because one of them is an
 * outage and the other is a quiet minute.
 */
export async function claimDueTargets(limit: number): Promise<ClaimedTarget[] | null> {
  const { data, error } = await createAdminClient().rpc('claim_due_targets', {
    max_batch: limit,
    lease_seconds: LEASE_SECONDS,
    max_attempts: MAX_PUBLISH_ATTEMPTS,
  })

  if (error) {
    console.error('[publish] claim failed: %s', error.message)
    return null
  }

  return data ?? []
}

/** Settles the post once its targets stop moving. */
export async function rollUpPost(postId: string): Promise<void> {
  const { error } = await createAdminClient().rpc('roll_up_post', { p: postId })
  if (error) console.error('[publish] roll-up of %s failed: %s', postId, error.message)
}

// --- recording what happened -------------------------------------------------

export async function recordPublished(
  target: ClaimedTarget,
  result: { externalPostId: string; permalink?: string | null; containerId?: string | null },
): Promise<void> {
  const admin = createAdminClient()

  await admin
    .from('post_targets')
    .update({
      status: 'published',
      external_post_id: result.externalPostId,
      external_permalink: result.permalink ?? null,
      external_container_id: result.containerId ?? target.external_container_id,
      published_at: new Date().toISOString(),
      lease_expires_at: null,
      next_attempt_at: null,
      last_error: null,
    })
    .eq('id', target.id)
    .eq('status', 'publishing')

  await rollUpPost(target.post_id)
}

/**
 * Instagram is still working on a container we already handed it.
 *
 * Not a failure, so the attempt is given back. The container id is kept, which
 * is what makes the next tick resume this publish rather than start a second
 * one.
 */
export async function recordStillProcessing(
  target: ClaimedTarget,
  containerId: string | null,
  retryAt: Date,
): Promise<void> {
  await createAdminClient()
    .from('post_targets')
    .update({
      status: 'pending',
      // The claim charged an attempt for what turned out to be waiting.
      attempts: Math.max(0, target.attempts - 1),
      external_container_id: containerId ?? target.external_container_id,
      next_attempt_at: retryAt.toISOString(),
      lease_expires_at: null,
    })
    .eq('id', target.id)
    .eq('status', 'publishing')
}

export type FailureRecord = {
  facts: Omit<FailureFacts, 'attempts'>
  /** What the platform (or we) said went wrong. */
  message: string
  /** For the server log only. */
  detail?: string
  containerId?: string | null
}

/**
 * Records a failed attempt, and decides whether there will be another.
 *
 * Returns true when the target is going to be retried, so the caller knows
 * whether this was the end of the story.
 */
export async function recordFailure(
  target: ClaimedTarget,
  failure: FailureRecord,
  now = new Date(),
): Promise<boolean> {
  const admin = createAdminClient()

  const outcome = decideAfterFailure(
    { ...failure.facts, attempts: target.attempts },
    now,
  )

  if (failure.detail) {
    console.error(
      '[publish] target %s (%s) attempt %d: %s',
      target.id,
      target.platform,
      target.attempts,
      failure.detail,
    )
  }

  if (outcome.kind === 'retry') {
    await admin
      .from('post_targets')
      .update({
        status: 'pending',
        last_error: failure.message,
        next_attempt_at: outcome.nextAttemptAt.toISOString(),
        external_container_id: failure.containerId ?? target.external_container_id,
        lease_expires_at: null,
      })
      .eq('id', target.id)
      .eq('status', 'publishing')

    // The post stays `publishing` between attempts. It is genuinely still in
    // flight, and Section 6.2's lock is what stops someone editing a post
    // halfway through its own fan-out.
    return true
  }

  await admin
    .from('post_targets')
    .update({
      status: 'failed',
      last_error: explainGivingUp(outcome.because, failure.message),
      external_container_id: failure.containerId ?? target.external_container_id,
      lease_expires_at: null,
      next_attempt_at: null,
    })
    .eq('id', target.id)
    .eq('status', 'publishing')

  await rollUpPost(target.post_id)
  return false
}

/**
 * A target that cannot be attempted at all — the account went away, the plan
 * lapsed, the media is gone. Distinct from a platform refusal: nothing was
 * sent, so there is nothing to reconcile and no attempt worth repeating.
 */
export async function abandonTarget(
  target: ClaimedTarget,
  reason: string,
): Promise<void> {
  await createAdminClient()
    .from('post_targets')
    .update({
      status: 'failed',
      last_error: reason,
      lease_expires_at: null,
      next_attempt_at: null,
    })
    .eq('id', target.id)
    .eq('status', 'publishing')

  await rollUpPost(target.post_id)
}

// --- telling people ----------------------------------------------------------

/**
 * Section 4: "...mark failed → notify."
 *
 * The row is written here; Module 8 decides which channels it goes out on.
 * Workspace-wide rather than to the author, because the person who scheduled a
 * post may have left (Section 6.3) and a failed post is everyone's problem.
 */
export async function notifyOutcome(params: {
  workspaceId: string
  postId: string
  platform: Platform
  accountName: string
  published: boolean
  error?: string | null
}): Promise<void> {
  const label = PLATFORM_LABELS[params.platform]

  await createAdminClient()
    .from('notifications')
    .insert({
      workspace_id: params.workspaceId,
      user_id: null,
      kind: params.published ? 'post_published' : 'post_failed',
      title: params.published
        ? `Published to ${label}`
        : `A post did not go out on ${label}`,
      body: params.published
        ? `Your post is live on ${params.accountName}.`
        : params.error ?? `We could not publish to ${params.accountName}.`,
      link_path: `${ROUTES.posts}/${params.postId}`,
      data: {
        post_id: params.postId,
        platform: params.platform,
      },
    })
}
