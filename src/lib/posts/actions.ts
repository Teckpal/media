'use server'

import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/auth/session'
import { canPublish, explainBlock } from '@/lib/billing/entitlements'
import { blockingIssues, validatePost, type MediaItem } from '@/lib/posts/validation'
import { runPublishTick } from '@/lib/publish/worker'
import { isPast, localInputToUtc } from '@/lib/time'
import { atLeast, type Platform } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import { fieldErrorsFrom, type FormState } from '@/lib/forms'
import type { PostStatusEnum, WorkspaceRoleEnum, WorkspaceRow } from '@/types/database'

/**
 * Section 6.2, the post and calendar rules.
 *
 * Almost every guard here is also a database trigger — the state machine, the
 * publishing lock, the refusal to schedule into the past. That duplication is
 * on purpose. The trigger is the backstop that the publish worker and any
 * future admin tool also meet; these checks are what turn a constraint
 * violation into a sentence a person can read.
 */

type Actor = {
  userId: string
  workspace: Pick<WorkspaceRow, 'id' | 'timezone' | 'is_billing_exempt' | 'approvals_enabled'>
  role: WorkspaceRoleEnum
}

/** Section 6.3: creating and editing posts is an editor's job upwards. */
async function requireEditor(): Promise<Actor> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  const supabase = await createClient()
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role, workspaces(id, timezone, is_billing_exempt, approvals_enabled)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle<{
      role: WorkspaceRoleEnum
      workspaces: Pick<
        WorkspaceRow,
        'id' | 'timezone' | 'is_billing_exempt' | 'approvals_enabled'
      > | null
    }>()

  if (!membership?.workspaces || !atLeast(membership.role, 'editor')) {
    redirect(`${ROUTES.posts}?error=forbidden`)
  }

  return {
    userId: user.id,
    workspace: membership.workspaces,
    role: membership.role,
  }
}

const composeSchema = z.object({
  postId: z.string().uuid().optional(),
  caption: z.string().max(63_206),
  mediaIds: z.array(z.string().uuid()).max(10),
  accountIds: z.array(z.string().uuid()).min(1, 'Choose at least one account.'),
  /** Wall-clock, read in the workspace's zone. Absent means "keep as a draft". */
  scheduledLocal: z.string().optional(),
})

function readComposeForm(formData: FormData) {
  // "Save as draft instead" is a submit button with its own name, so the
  // schedule field still arrives filled in. Honouring the button is what makes
  // the choice the user actually clicked the one that takes effect.
  const saveAsDraft = formData.get('saveAsDraft') === '1'

  return composeSchema.safeParse({
    postId: formData.get('postId') || undefined,
    caption: formData.get('caption') ?? '',
    mediaIds: formData.getAll('mediaId').map(String).filter(Boolean),
    accountIds: formData.getAll('accountId').map(String).filter(Boolean),
    scheduledLocal: saveAsDraft ? undefined : formData.get('scheduledLocal') || undefined,
  })
}

/**
 * Loads the media rows the composer named, so validation runs against what is
 * actually stored rather than what the form claimed.
 */
async function loadMedia(workspaceId: string, ids: string[]): Promise<MediaItem[]> {
  if (ids.length === 0) return []

  const supabase = await createClient()
  const { data } = await supabase
    .from('post_media')
    .select('id, mime_type, byte_size, width, height, duration_ms')
    .eq('workspace_id', workspaceId)
    .in('id', ids)

  // Preserves the order the user arranged, which is part of the content for a
  // carousel.
  const byId = new Map((data ?? []).map((m) => [m.id, m]))

  return ids
    .map((id) => byId.get(id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .map((m) => ({
      id: m.id,
      mimeType: m.mime_type,
      byteSize: m.byte_size,
      width: m.width,
      height: m.height,
      durationMs: m.duration_ms,
    }))
}

/** The accounts a post is aimed at, scoped to the workspace. */
async function loadTargets(workspaceId: string, ids: string[]) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('social_accounts')
    .select('id, platform, display_name, external_username, status, paid_seat')
    .eq('workspace_id', workspaceId)
    .in('id', ids)

  return data ?? []
}

// --- save -------------------------------------------------------------------

/**
 * Saves a draft, or schedules one, depending on whether a time was given.
 *
 * One action rather than two, because the checks are the same either way and
 * the only difference is how far the post is allowed to travel.
 */
export async function savePostAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireEditor()

  const parsed = readComposeForm(formData)
  if (!parsed.success) {
    return { error: 'Check the fields below.', fieldErrors: fieldErrorsFrom(parsed.error.issues) }
  }

  const { postId, caption, mediaIds, accountIds, scheduledLocal } = parsed.data
  const wantsSchedule = Boolean(scheduledLocal)

  const targets = await loadTargets(actor.workspace.id, accountIds)
  if (targets.length !== accountIds.length) {
    return { error: 'One of those accounts is no longer connected.' }
  }

  // Section 6.2: re-validate media and caption per platform, on every save —
  // including an edit to a post that was already scheduled.
  const media = await loadMedia(actor.workspace.id, mediaIds)
  const platforms = targets.map((t) => t.platform as Platform)
  const issues = blockingIssues(validatePost(platforms, { caption, media }))

  if (issues.length > 0) {
    return {
      error: issues[0].message,
      fieldErrors: Object.fromEntries(issues.map((i) => [i.field, i.message])),
    }
  }

  let scheduledAt: Date | null = null

  if (wantsSchedule) {
    scheduledAt = localInputToUtc(scheduledLocal!, actor.workspace.timezone)
    if (!scheduledAt) {
      return { error: 'That date and time could not be read.', fieldErrors: { scheduledLocal: 'Pick a date and time.' } }
    }

    // Section 6.2: scheduling into the past is rejected. The composer offers
    // "Publish now" instead, which still meets the publish gate.
    if (isPast(scheduledAt)) {
      return {
        error: 'That time has already passed. Pick a later time, or publish now.',
        fieldErrors: { scheduledLocal: 'This is in the past.' },
      }
    }

    // Gate 2. Checked here, on the server, for the exact accounts this post is
    // going to — not for the workspace in general.
    const entitlement = await canPublish(actor.workspace, accountIds)
    if (!entitlement.allowed) {
      return { error: explainBlock(entitlement.block) }
    }
  }

  const supabase = await createClient()

  // Section 6.3: an editor's post goes to pending_approval when approvals are
  // on. An admin or owner scheduling their own post does not queue behind
  // themselves.
  const needsApproval =
    wantsSchedule && actor.workspace.approvals_enabled && !atLeast(actor.role, 'admin')

  const status: PostStatusEnum = wantsSchedule
    ? needsApproval
      ? 'pending_approval'
      : 'scheduled'
    : 'draft'

  let savedId = postId

  if (postId) {
    // Scoped to the workspace, and to the states an edit is allowed from.
    // A post that is publishing is locked (Section 6.2) and the database
    // trigger refuses the write regardless.
    const { data: current } = await supabase
      .from('posts')
      .select('id, status')
      .eq('id', postId)
      .eq('workspace_id', actor.workspace.id)
      .maybeSingle()

    if (!current) return { error: 'That post no longer exists.' }

    if (current.status === 'publishing') {
      return { error: 'This post is being published right now and cannot be changed.' }
    }

    if (['published', 'removed', 'cancelled'].includes(current.status)) {
      return { error: 'A post that has already gone out cannot be edited.' }
    }

    const { error } = await supabase
      .from('posts')
      .update({
        caption,
        media_ids: mediaIds,
        scheduled_at: scheduledAt?.toISOString() ?? null,
        status,
      })
      .eq('id', postId)

    if (error) return { error: 'Could not save that. Try again.' }
  } else {
    const { data: created, error } = await supabase
      .from('posts')
      .insert({
        workspace_id: actor.workspace.id,
        created_by: actor.userId,
        caption,
        media_ids: mediaIds,
        scheduled_at: scheduledAt?.toISOString() ?? null,
        status,
      })
      .select('id')
      .single()

    if (error || !created) return { error: 'Could not save that. Try again.' }
    savedId = created.id
  }

  await syncTargets(savedId!, accountIds, targets)

  revalidatePath(ROUTES.posts)
  revalidatePath(ROUTES.calendar)
  redirect(`${ROUTES.posts}/${savedId}?saved=1`)
}

/**
 * Brings `post_targets` in line with the chosen accounts.
 *
 * An idempotency key is minted once per target and never regenerated
 * (Section 6.2, double publish) — so a target that survives an edit keeps the
 * key it would publish under, and a retry after an ambiguous timeout cannot
 * post twice.
 */
async function syncTargets(
  postId: string,
  accountIds: string[],
  targets: { id: string; platform: string }[],
): Promise<void> {
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('post_targets')
    .select('id, social_account_id, status')
    .eq('post_id', postId)

  const have = new Map((existing ?? []).map((t) => [t.social_account_id, t]))
  const wanted = new Set(accountIds)

  const toAdd = accountIds
    .filter((id) => !have.has(id))
    .map((id) => ({
      post_id: postId,
      social_account_id: id,
      platform: targets.find((t) => t.id === id)!.platform as Platform,
      idempotency_key: `${postId}:${id}:${randomUUID()}`,
      status: 'pending' as const,
    }))

  if (toAdd.length > 0) {
    await supabase.from('post_targets').insert(toAdd)
  }

  // Removed from the composer. Cancelled rather than deleted, so a target that
  // already published keeps its record of having done so.
  const toDrop = (existing ?? []).filter(
    (t) => !wanted.has(t.social_account_id) && t.status === 'pending',
  )

  if (toDrop.length > 0) {
    await supabase
      .from('post_targets')
      .update({ status: 'cancelled' })
      .in(
        'id',
        toDrop.map((t) => t.id),
      )
  }

  // Module 6: a target that failed last time is what rescheduling a failed post
  // is *for*, so it goes back in the queue with a clean slate. One that already
  // published does not — Section 6.2's worst outcome is a post going out twice,
  // and "try the whole thing again" is exactly how that happens.
  const toRevive = (existing ?? []).filter(
    (t) => wanted.has(t.social_account_id) && t.status === 'failed',
  )

  if (toRevive.length > 0) {
    await supabase
      .from('post_targets')
      .update({
        status: 'pending',
        attempts: 0,
        last_error: null,
        next_attempt_at: null,
        lease_expires_at: null,
        // A new run needs a new container; the old one has expired by now.
        external_container_id: null,
      })
      .in(
        'id',
        toRevive.map((t) => t.id),
      )
  }
}

// --- state changes -----------------------------------------------------------

const postIdSchema = z.object({ postId: z.string().uuid() })

async function loadOwnPost(workspaceId: string, postId: string) {
  const supabase = await createClient()
  return supabase
    .from('posts')
    .select('id, status, scheduled_at')
    .eq('id', postId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
}

/**
 * Section 6.2, "Pause (halting)": scheduled becomes paused and the job leaves
 * the queue. Pausing while publishing is not allowed — the trigger refuses it
 * too, but saying so plainly is better than surfacing a constraint violation.
 */
export async function pausePostAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireEditor()
  const parsed = postIdSchema.safeParse({ postId: formData.get('postId') })
  if (!parsed.success) return { error: 'Unknown post.' }

  const { data: post } = await loadOwnPost(actor.workspace.id, parsed.data.postId)
  if (!post) return { error: 'Unknown post.' }

  if (post.status === 'publishing') {
    return { error: 'This post is going out right now and can no longer be paused.' }
  }

  if (post.status !== 'scheduled') {
    return { error: 'Only a scheduled post can be paused.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('posts')
    .update({ status: 'paused' })
    .eq('id', post.id)
    .eq('status', 'scheduled') // loses cleanly if the worker claimed it first

  if (error) return { error: 'Could not pause that post.' }

  revalidatePath(ROUTES.posts)
  revalidatePath(ROUTES.calendar)
  return { error: null, notice: 'Paused. It will not go out until you resume it.' }
}

/**
 * Section 6.2: "Resume — if time passed, must pick new time."
 *
 * So a resume whose moment has gone does not quietly publish late, and does not
 * silently pick a time on the user's behalf either. It sends them back to the
 * composer to choose.
 */
export async function resumePostAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireEditor()
  const parsed = postIdSchema.safeParse({ postId: formData.get('postId') })
  if (!parsed.success) return { error: 'Unknown post.' }

  const { data: post } = await loadOwnPost(actor.workspace.id, parsed.data.postId)
  if (!post) return { error: 'Unknown post.' }
  if (post.status !== 'paused') return { error: 'Only a paused post can be resumed.' }

  if (!post.scheduled_at || isPast(post.scheduled_at)) {
    redirect(`${ROUTES.posts}/${post.id}?reschedule=1`)
  }

  const { data: targets } = await (await createClient())
    .from('post_targets')
    .select('social_account_id')
    .eq('post_id', post.id)
    .eq('status', 'pending')

  const accountIds = (targets ?? []).map((t) => t.social_account_id)

  // The gate is re-checked on resume. A subscription may have lapsed, or an
  // account lost its seat, while the post sat paused.
  const entitlement = await canPublish(actor.workspace, accountIds)
  if (!entitlement.allowed) return { error: explainBlock(entitlement.block) }

  const supabase = await createClient()
  const { error } = await supabase
    .from('posts')
    .update({ status: 'scheduled' })
    .eq('id', post.id)
    .eq('status', 'paused')

  if (error) return { error: 'Could not resume that post.' }

  revalidatePath(ROUTES.posts)
  revalidatePath(ROUTES.calendar)
  return { error: null, notice: 'Resumed.' }
}

/**
 * Section 6.2: "Publish now" — the answer the composer offers when a chosen
 * time has already passed.
 *
 * It does not publish inline. It puts the post at the front of the same queue
 * everything else goes through, and then nudges the worker so the user does not
 * wait for the next minute's cron. Publishing inside the request would mean a
 * user's click holding a serverless function open through a video upload, and a
 * closed tab losing the post.
 *
 * Everything the scheduled path checks is checked here too, because "now" is
 * still a schedule — it is just a short one.
 */
export async function publishNowAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireEditor()
  const parsed = postIdSchema.safeParse({ postId: formData.get('postId') })
  if (!parsed.success) return { error: 'Unknown post.' }

  const supabase = await createClient()

  const { data: post } = await supabase
    .from('posts')
    .select('id, status, caption, media_ids')
    .eq('id', parsed.data.postId)
    .eq('workspace_id', actor.workspace.id)
    .maybeSingle()

  if (!post) return { error: 'Unknown post.' }

  if (post.status === 'publishing') {
    return { error: 'This post is already going out.' }
  }

  if (!['draft', 'scheduled', 'paused', 'failed'].includes(post.status)) {
    return { error: 'That post has already finished.' }
  }

  // Section 6.3: an editor cannot route around approvals by publishing now.
  if (actor.workspace.approvals_enabled && !atLeast(actor.role, 'admin')) {
    return { error: 'An admin or owner has to approve this before it can go out.' }
  }

  const { data: targetRows } = await supabase
    .from('post_targets')
    .select('social_account_id')
    .eq('post_id', post.id)
    .in('status', ['pending', 'failed'])

  const accountIds = [...new Set((targetRows ?? []).map((t) => t.social_account_id))]
  if (accountIds.length === 0) {
    return { error: 'Choose at least one account before publishing.' }
  }

  const accounts = await loadTargets(actor.workspace.id, accountIds)

  // Re-validated, because the post may have been sitting as a draft since
  // before its media was changed.
  const media = await loadMedia(actor.workspace.id, post.media_ids)
  const issues = blockingIssues(
    validatePost(
      accounts.map((a) => a.platform as Platform),
      { caption: post.caption, media },
    ),
  )

  if (issues.length > 0) return { error: issues[0].message }

  const entitlement = await canPublish(actor.workspace, accountIds)
  if (!entitlement.allowed) return { error: explainBlock(entitlement.block) }

  // A target that failed earlier is why someone is pressing this button.
  // Published ones are left alone — sending those again is the double publish
  // Section 6.2 exists to prevent.
  await supabase
    .from('post_targets')
    .update({
      status: 'pending',
      attempts: 0,
      last_error: null,
      next_attempt_at: null,
      lease_expires_at: null,
      external_container_id: null,
    })
    .eq('post_id', post.id)
    .eq('status', 'failed')

  const { error } = await supabase
    .from('posts')
    .update({ status: 'scheduled', scheduled_at: new Date().toISOString() })
    .eq('id', post.id)
    // Loses cleanly if anything moved the post while this was being decided.
    .eq('status', post.status)

  if (error) return { error: 'Could not publish that post. Try again.' }

  // The queue would find this within the minute anyway; `after` runs the tick
  // once the response has gone, so the user sees the click take effect without
  // waiting for the send. If the invocation dies here, the cron is the backstop
  // — nothing about the post's state depends on this call happening.
  after(async () => {
    try {
      await runPublishTick({ limit: 5 })
    } catch (cause) {
      console.error('[publish] nudge after publish-now failed: %s', String(cause))
    }
  })

  revalidatePath(ROUTES.posts)
  revalidatePath(ROUTES.calendar)
  return { error: null, notice: 'Going out now. Refresh in a moment to see how it landed.' }
}

export async function cancelPostAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireEditor()
  const parsed = postIdSchema.safeParse({ postId: formData.get('postId') })
  if (!parsed.success) return { error: 'Unknown post.' }

  const { data: post } = await loadOwnPost(actor.workspace.id, parsed.data.postId)
  if (!post) return { error: 'Unknown post.' }

  if (post.status === 'publishing') {
    return { error: 'This post is going out right now and can no longer be cancelled.' }
  }

  if (['published', 'removed', 'cancelled'].includes(post.status)) {
    return { error: 'That post has already finished.' }
  }

  const supabase = await createClient()
  await supabase.from('posts').update({ status: 'cancelled' }).eq('id', post.id)
  await supabase
    .from('post_targets')
    .update({ status: 'cancelled' })
    .eq('post_id', post.id)
    .eq('status', 'pending')

  revalidatePath(ROUTES.posts)
  revalidatePath(ROUTES.calendar)
  return { error: null, notice: 'Cancelled.' }
}

/**
 * Section 6.2, "Delete published post": removed from the app only.
 *
 * The post stays live on the platform. The row survives for the audit log, the
 * UI hides it, and the confirm dialog says so in as many words — this is the
 * one destructive-looking action in the app that is not actually destructive,
 * and the one people most often expect to be.
 */
export async function removePublishedAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireEditor()
  const parsed = postIdSchema.safeParse({ postId: formData.get('postId') })
  if (!parsed.success) return { error: 'Unknown post.' }

  const { data: post } = await loadOwnPost(actor.workspace.id, parsed.data.postId)
  if (!post) return { error: 'Unknown post.' }
  if (post.status !== 'published') {
    return { error: 'Only a published post can be removed from the app.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('posts')
    .update({ status: 'removed', removed_by: actor.userId })
    .eq('id', post.id)
    .eq('status', 'published')

  if (error) return { error: 'Could not remove that post.' }

  await supabase.from('audit_log').insert({
    workspace_id: actor.workspace.id,
    actor_id: actor.userId,
    action: 'post.removed',
    entity_type: 'post',
    entity_id: post.id,
    source: 'web',
    detail: { note: 'removed from app only; still live on the platform' },
  })

  revalidatePath(ROUTES.posts)
  revalidatePath(ROUTES.calendar)
  return { error: null, notice: 'Removed from motif Social. It is still live on the platform.' }
}

/** A draft has never gone anywhere, so deleting one is a real delete. */
export async function deleteDraftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireEditor()
  const parsed = postIdSchema.safeParse({ postId: formData.get('postId') })
  if (!parsed.success) return { error: 'Unknown post.' }

  const { data: post } = await loadOwnPost(actor.workspace.id, parsed.data.postId)
  if (!post) return { error: 'Unknown post.' }
  if (post.status !== 'draft') {
    return { error: 'Only a draft can be deleted. Cancel it instead.' }
  }

  const supabase = await createClient()
  await supabase.from('posts').delete().eq('id', post.id).eq('status', 'draft')

  revalidatePath(ROUTES.posts)
  redirect(ROUTES.posts)
}
