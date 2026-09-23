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
import { dayKeyInZone, formatDateTimeInZone, isPast, localInputToUtc } from '@/lib/time'
import { atLeast, PLATFORM_LABELS, type Platform } from '@/lib/constants'
import { recordAudit } from '@/lib/audit/record'
import { announce, actorName } from '@/lib/notifications/announce'
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
  /** For the sentence in the notification: "Rina removed a post". */
  name: string
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
    name: actorName({ full_name: user.profile.full_name, email: user.email }),
  }
}

const composeSchema = z.object({
  postId: z.string().uuid().optional(),
  caption: z.string().max(63_206),
  mediaIds: z.array(z.string().uuid()).max(10),
  accountIds: z.array(z.string().uuid()).min(1, 'Choose at least one account.'),
  /** Wall-clock, read in the workspace's zone. Absent means "keep as a draft". */
  scheduledLocal: z.string().optional(),
  /** "Post now" — a schedule of zero length rather than a separate path. */
  publishNow: z.boolean(),
})

function readComposeForm(formData: FormData) {
  // Three submit buttons, each with its own name, so the server honours the
  // one actually clicked rather than whatever the fields happen to hold. An
  // `onClick` that cleared state would not have re-rendered before the form
  // posted, and the stale value would go with it.
  const saveAsDraft = formData.get('saveAsDraft') === '1'
  const publishNow = formData.get('publishNow') === '1'

  return composeSchema.safeParse({
    postId: formData.get('postId') || undefined,
    caption: formData.get('caption') ?? '',
    mediaIds: formData.getAll('mediaId').map(String).filter(Boolean),
    accountIds: formData.getAll('accountId').map(String).filter(Boolean),
    // "Post now" ignores the time in the box for the same reason "save as
    // draft" does: the button is the instruction.
    scheduledLocal:
      saveAsDraft || publishNow ? undefined : formData.get('scheduledLocal') || undefined,
    publishNow,
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

  const { postId, caption, mediaIds, accountIds, scheduledLocal, publishNow } = parsed.data

  // "Now" is still a schedule — it is just a short one. Treating it as one
  // rather than as a separate path means every check below runs unchanged:
  // the platform validation, the publish gate, and the approvals rule an
  // editor must not be able to step around by choosing a different button.
  const wantsSchedule = Boolean(scheduledLocal) || publishNow

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

  if (publishNow) {
    scheduledAt = new Date()
  } else if (wantsSchedule) {
    scheduledAt = localInputToUtc(scheduledLocal!, actor.workspace.timezone)
    if (!scheduledAt) {
      return { error: 'That date and time could not be read.', fieldErrors: { scheduledLocal: 'Pick a date and time.' } }
    }

    // Section 6.2: scheduling into the past is rejected. The composer offers
    // "Post now" instead, which still meets the publish gate.
    if (isPast(scheduledAt)) {
      return {
        error: 'That time has already passed. Pick a later time, or post now.',
        fieldErrors: { scheduledLocal: 'This is in the past.' },
      }
    }
  }

  if (wantsSchedule) {
    // Gate 2. Checked here, on the server, for the exact accounts this post is
    // going to — not for the workspace in general. Applies to "post now"
    // identically; the button is a convenience, never a way around the gate.
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

  // Section 8: the workspace is told. A draft is nobody else's business until
  // it is aimed at a time, so only the two states that mean "this is going
  // out" are announced — and `pending_approval` is announced loudest, because
  // it is the one waiting on somebody.
  if (status === 'scheduled' || status === 'pending_approval') {
    const where = targets.map((t) => PLATFORM_LABELS[t.platform as Platform]).join(', ')

    await announce({
      workspaceId: actor.workspace.id,
      actorId: actor.userId,
      kind: status === 'pending_approval' ? 'approval_requested' : 'post_scheduled',
      title:
        status === 'pending_approval'
          ? `${actor.name} needs a post approved`
          : publishNow
            ? `${actor.name} is publishing a post now`
            : `${actor.name} scheduled a post`,
      body:
        status === 'pending_approval'
          ? `For ${where}. It will not go out until an admin approves it.`
          : publishNow
            ? `Going out to ${where} now.`
            : `To ${where}, on ${formatDateTimeInZone(scheduledAt!, actor.workspace.timezone)}.`,
      linkPath: `${ROUTES.posts}/${savedId}`,
      detail: { post_id: savedId, platforms: targets.map((t) => t.platform) },
    })
  }

  // Nudge the queue for a post meant to go out now, rather than leaving it to
  // the next cron tick up to a minute away. `after` runs once the response has
  // gone, so the click takes effect without waiting for the send — and the
  // cron remains the backstop if this invocation dies, because nothing about
  // the post's state depends on it happening.
  if (publishNow && status === 'scheduled') {
    after(async () => {
      try {
        await runPublishTick({ limit: 5 })
      } catch (cause) {
        console.error('[publish] nudge after post-now failed: %s', String(cause))
      }
    })
  }

  revalidatePath(ROUTES.posts)
  revalidatePath(ROUTES.calendar)

  /**
   * A post with a time on it belongs on the calendar, so that is where saving
   * one ends up.
   *
   * The composer answers "what does this say"; the calendar answers "when does
   * it go out, and what is it going out next to" — which is the question
   * somebody has the moment they finish writing. Landing back on the post's own
   * page shows them the thing they have just been staring at.
   *
   * A draft is the exception, and not an arbitrary one: a draft has no
   * `scheduled_at`, the calendar query filters those out, and sending somebody
   * to a grid their post is provably not on would be a dead end.
   *
   * The month is worked out in the workspace's zone, because a 00:30 post on
   * the first of the month is still the previous month in UTC.
   */
  if (scheduledAt) {
    const [y, m] = dayKeyInZone(scheduledAt, actor.workspace.timezone).split('-')
    redirect(`${ROUTES.calendar}?y=${y}&m=${Number(m)}&saved=${savedId}`)
  }

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
/**
 * The small edit: a caption and a time, from the calendar.
 *
 * Every rule the composer applies still applies here — the same per-platform
 * validation, the same publish gate, the same refusal to schedule into the
 * past. What is missing is only the *fields*: media and accounts are not on
 * this form, so they are not touched, and the panel links to the full composer
 * for those.
 *
 * It exists because most edits are one of these two things. Opening a
 * four-section composer to fix a typo, from a calendar you were reading, is
 * the trip this removes.
 */
const quickEditSchema = z.object({
  postId: z.string().uuid(),
  caption: z.string().max(63_206),
  /** Wall-clock in the workspace zone. Empty leaves the time alone. */
  scheduledLocal: z.string().optional(),
})

export async function quickEditPostAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireEditor()

  const parsed = quickEditSchema.safeParse({
    postId: formData.get('postId'),
    caption: formData.get('caption') ?? '',
    scheduledLocal: formData.get('scheduledLocal') || undefined,
  })

  if (!parsed.success) return { error: 'Check the fields below.' }

  const { postId, caption, scheduledLocal } = parsed.data

  // Not `loadOwnPost`: the media is needed too, to re-validate the caption
  // against what the post actually carries.
  const supabaseRead = await createClient()
  const { data: post } = await supabaseRead
    .from('posts')
    .select('id, status, scheduled_at, media_ids')
    .eq('id', postId)
    .eq('workspace_id', actor.workspace.id)
    .maybeSingle<{
      id: string
      status: PostStatusEnum
      scheduled_at: string | null
      media_ids: string[] | null
    }>()

  if (!post) return { error: 'That post no longer exists.' }

  // Section 6.2: a post being published is locked, and one that has finished
  // is history. The database refuses these too.
  if (post.status === 'publishing') {
    return { error: 'This post is going out right now and cannot be changed.' }
  }
  if (['published', 'removed', 'cancelled'].includes(post.status)) {
    return { error: 'A post that has already gone out cannot be edited.' }
  }

  const supabase = await createClient()

  const { data: targetRows } = await supabase
    .from('post_targets')
    .select('social_account_id')
    .eq('post_id', post.id)
    .not('status', 'in', '("cancelled")')

  const accountIds = [...new Set((targetRows ?? []).map((t) => t.social_account_id))]
  const accounts = await loadTargets(actor.workspace.id, accountIds)

  // Re-validated against the platforms this post actually goes to. A caption
  // that fitted when it was written may not fit now.
  const media = await loadMedia(actor.workspace.id, post.media_ids ?? [])
  const issues = blockingIssues(
    validatePost(
      accounts.map((a) => a.platform as Platform),
      { caption, media },
    ),
  )

  if (issues.length > 0) {
    return { error: issues[0].message, fieldErrors: { caption: issues[0].message } }
  }

  let scheduledAt: Date | null = null

  if (scheduledLocal) {
    scheduledAt = localInputToUtc(scheduledLocal, actor.workspace.timezone)
    if (!scheduledAt) return { error: 'That date and time could not be read.' }

    if (isPast(scheduledAt)) {
      return {
        error: 'That time has already passed. Pick a later one.',
        fieldErrors: { scheduledLocal: 'This is in the past.' },
      }
    }

    // Gate 2, for the exact accounts this post goes to. Moving a post is
    // scheduling it, and scheduling is what the gate governs.
    const entitlement = await canPublish(actor.workspace, accountIds)
    if (!entitlement.allowed) return { error: explainBlock(entitlement.block) }
  }

  const { error } = await supabase
    .from('posts')
    .update({
      caption,
      ...(scheduledAt ? { scheduled_at: scheduledAt.toISOString() } : {}),
    })
    .eq('id', post.id)
    .eq('workspace_id', actor.workspace.id)
    // Loses cleanly if the worker claimed it while this was being decided.
    .neq('status', 'publishing')

  if (error) return { error: 'Could not save that. Try again.' }

  // Only when the time actually moved. A typo fixed at nine in the morning is
  // not news; a post that now goes out on a different day is.
  const moved = scheduledAt && post.scheduled_at
    ? new Date(post.scheduled_at).getTime() !== scheduledAt.getTime()
    : Boolean(scheduledAt)

  if (moved && scheduledAt) {
    await announce({
      workspaceId: actor.workspace.id,
      actorId: actor.userId,
      kind: 'post_rescheduled',
      title: `${actor.name} moved a post`,
      body: post.scheduled_at
        ? `From ${formatDateTimeInZone(post.scheduled_at, actor.workspace.timezone)} to ${formatDateTimeInZone(scheduledAt, actor.workspace.timezone)}.`
        : `Now going out on ${formatDateTimeInZone(scheduledAt, actor.workspace.timezone)}.`,
      linkPath: `${ROUTES.posts}/${post.id}`,
      detail: { post_ids: [post.id] },
    })
  }

  revalidatePath(ROUTES.calendar)
  revalidatePath(ROUTES.posts)
  return { error: null, notice: 'Saved.' }
}

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

  await announce({
    workspaceId: actor.workspace.id,
    actorId: actor.userId,
    kind: 'post_publishing',
    title: `${actor.name} is publishing a post now`,
    body: `Going out to ${accounts.map((a) => PLATFORM_LABELS[a.platform as Platform]).join(', ')}.`,
    linkPath: `${ROUTES.posts}/${post.id}`,
    detail: { post_id: post.id },
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

  await announce({
    workspaceId: actor.workspace.id,
    actorId: actor.userId,
    kind: 'post_cancelled',
    title: `${actor.name} cancelled a scheduled post`,
    body: 'It will not go out. The post is still here if it is wanted again.',
    linkPath: `${ROUTES.posts}/${post.id}`,
    detail: { post_id: post.id },
  })

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

  // Through the service role, not `supabase`. `audit_log` has no INSERT policy
  // for `authenticated` — that is what makes it append-only — so the write
  // this used to do here was refused every time, and the discarded error made
  // it look like it worked. Section 6.2 wants removed posts kept.
  await recordAudit({
    workspaceId: actor.workspace.id,
    actorId: actor.userId,
    action: 'post.removed',
    entityType: 'post',
    entityId: post.id,
    detail: { note: 'removed from app only; still live on the platform' },
  })

  await announce({
    workspaceId: actor.workspace.id,
    actorId: actor.userId,
    kind: 'post_removed',
    title: `${actor.name} removed a published post`,
    body: 'It is out of motif Social but still live on the platform.',
    linkPath: `${ROUTES.posts}/${post.id}`,
    detail: { post_id: post.id },
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

  // No `linkPath`: the row is gone, and a notification that navigates to a
  // 404 is worse than one that simply says what happened. This is the only
  // deletion in the app that really deletes, which is exactly why the rest of
  // the team should hear about it.
  await announce({
    workspaceId: actor.workspace.id,
    actorId: actor.userId,
    kind: 'post_deleted',
    title: `${actor.name} deleted a draft`,
    body: 'A draft that had never gone out was removed for good.',
    detail: { post_id: post.id },
  })

  await recordAudit({
    workspaceId: actor.workspace.id,
    actorId: actor.userId,
    action: 'post.deleted',
    entityType: 'post',
    entityId: post.id,
    detail: { note: 'draft deleted permanently' },
  })

  revalidatePath(ROUTES.posts)
  redirect(ROUTES.posts)
}

/**
 * Section 6.2, the calendar's drag: move posts to another day, keeping the
 * time of day they already had.
 *
 * Applied as a batch, because a swap is two moves that only make sense
 * together — landing one of them and refusing the other would leave two posts
 * on the same day with the wrong owner's time.
 *
 * Every rule is checked again here even though the grid has already checked it.
 * The grid is a convenience; this is the boundary. A post that started
 * publishing in the seconds since the page rendered must not move, and neither
 * must anything into the past.
 */
const rescheduleSchema = z.object({
  moves: z
    .array(
      z.object({
        postId: z.string().uuid(),
        /** Wall-clock in the workspace's zone, `YYYY-MM-DDTHH:mm`. */
        scheduledAt: z.string().min(16),
      }),
    )
    .min(1)
    .max(50),
})

export async function reschedulePostsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireEditor()

  let payload: unknown
  try {
    payload = JSON.parse(String(formData.get('moves') ?? ''))
  } catch {
    return { error: 'Could not read those changes.' }
  }

  const parsed = rescheduleSchema.safeParse({ moves: payload })
  if (!parsed.success) return { error: 'Could not read those changes.' }

  const timezone = actor.workspace.timezone
  const supabase = await createClient()

  /**
   * What actually moved, collected as it goes.
   *
   * Announced after the loop rather than inside it. A drag on the calendar
   * that swaps two posts is two moves that only make sense together, and a
   * notification per move would say the workspace did two unrelated things —
   * then say it again with a chime. One notification per gesture.
   *
   * It also has to be after: any move can still return an error and abandon
   * the batch, and a notification about a change that was then refused is
   * worse than none.
   */
  const moved: { postId: string; from: string | null; to: Date }[] = []

  for (const move of parsed.data.moves) {
    const when = localInputToUtc(move.scheduledAt, timezone)
    if (!when) return { error: 'One of those dates could not be read.' }

    const { data: post } = await loadOwnPost(actor.workspace.id, move.postId)
    if (!post) return { error: 'One of those posts is no longer here.' }

    if (post.status === 'publishing') {
      return { error: 'One of those posts is going out right now and cannot be moved.' }
    }

    // Section 6.2. The database refuses this too; saying it here means the
    // message names the rule rather than showing a constraint violation.
    if (post.status === 'scheduled' && isPast(when)) {
      return { error: 'That would put a scheduled post in the past.' }
    }

    const { error } = await supabase
      .from('posts')
      .update({ scheduled_at: when.toISOString() })
      .eq('id', post.id)
      .neq('status', 'publishing')

    if (error) return { error: 'Could not move one of those posts.' }

    moved.push({ postId: post.id, from: post.scheduled_at, to: when })
  }

  const count = moved.length

  if (count > 0) {
    const one = moved[0]

    await announce({
      workspaceId: actor.workspace.id,
      actorId: actor.userId,
      kind: 'post_rescheduled',
      title:
        count === 1
          ? `${actor.name} moved a post`
          : `${actor.name} moved ${count} posts`,
      body:
        count === 1
          ? one.from
            ? `From ${formatDateTimeInZone(one.from, timezone)} to ${formatDateTimeInZone(one.to, timezone)}.`
            : `Now going out on ${formatDateTimeInZone(one.to, timezone)}.`
          : 'The calendar was rearranged.',
      // A single move opens the post; a batch opens the calendar, where the
      // rearrangement is the thing to look at.
      linkPath: count === 1 ? `${ROUTES.posts}/${one.postId}` : ROUTES.calendar,
      detail: { post_ids: moved.map((m) => m.postId) },
    })
  }

  revalidatePath(ROUTES.calendar)
  revalidatePath(ROUTES.posts)

  return { error: null, notice: `Saved. ${count} post${count === 1 ? '' : 's'} moved.` }
}
