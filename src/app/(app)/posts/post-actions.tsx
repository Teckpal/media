'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import {
  cancelPostAction,
  deleteDraftAction,
  pausePostAction,
  publishNowAction,
  removePublishedAction,
  resumePostAction,
} from '@/lib/posts/actions'
import { EMPTY_FORM_STATE, type FormState } from '@/lib/forms'
import { PLATFORM_LABELS, type Platform, type PostStatus } from '@/lib/constants'

type ActionFn = (prev: FormState, formData: FormData) => Promise<FormState>

function ActionButton({
  action,
  postId,
  label,
  busyLabel,
  variant = 'secondary',
}: {
  action: ActionFn
  postId: string
  label: string
  busyLabel: string
  variant?: 'secondary' | 'ghost' | 'danger'
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM_STATE)

  return (
    <div className="space-y-2">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}

      <form action={formAction}>
        <input type="hidden" name="postId" value={postId} />
        <Button type="submit" variant={variant} size="sm" disabled={pending}>
          {pending ? busyLabel : label}
        </Button>
      </form>
    </div>
  )
}

/**
 * Section 6.2, "Delete published post".
 *
 * The one action in the app that looks destructive and is not: the post stays
 * live on the platform and only leaves motif Social. The note specifies the
 * sentence, so it is shown before the second click rather than afterwards.
 */
function RemovePublished({
  postId,
  platforms,
}: {
  postId: string
  platforms: Platform[]
}) {
  const [state, formAction, pending] = useActionState(
    removePublishedAction,
    EMPTY_FORM_STATE,
  )
  const [confirming, setConfirming] = useState(false)

  const where =
    platforms.length > 0
      ? platforms.map((p) => PLATFORM_LABELS[p]).join(' and ')
      : 'the platform'

  if (state.notice) return <Alert tone="success">{state.notice}</Alert>

  return (
    <div className="space-y-2">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      {confirming ? (
        <Alert tone="warning" title={`This stays live on ${where}.`}>
          <p className="mb-3">
            Removing it here hides it from motif Social and keeps it in your
            audit log. It does not delete anything from {where} — do that in the
            app itself.
          </p>

          <div className="flex flex-wrap gap-2">
            <form action={formAction}>
              <input type="hidden" name="postId" value={postId} />
              <Button type="submit" variant="danger" size="sm" disabled={pending}>
                {pending ? 'Removing…' : 'Remove from motif Social'}
              </Button>
            </form>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Keep it
            </Button>
          </div>
        </Alert>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          Remove from motif Social
        </Button>
      )}
    </div>
  )
}

/**
 * The actions a post's current state actually allows.
 *
 * Driven by the same state machine the database enforces: a publishing post
 * offers nothing at all, because Section 6.2 locks it.
 */
export function PostActions({
  postId,
  status,
  platforms,
}: {
  postId: string
  status: PostStatus
  platforms: Platform[]
}) {
  // Section 6.2. A failed post is included because retrying it is the whole
  // point of telling someone it failed; a published one is not, because
  // sending it again is the one thing the app must never do by accident.
  const canPublishNow = ['draft', 'scheduled', 'paused', 'failed'].includes(status)

  return (
    <div className="flex flex-wrap items-start gap-2">
      {canPublishNow ? (
        <ActionButton
          action={publishNowAction}
          postId={postId}
          label={status === 'failed' ? 'Try again now' : 'Publish now'}
          busyLabel="Sending…"
        />
      ) : null}

      {status === 'scheduled' ? (
        <ActionButton
          action={pausePostAction}
          postId={postId}
          label="Pause"
          busyLabel="Pausing…"
        />
      ) : null}

      {status === 'paused' ? (
        <ActionButton
          action={resumePostAction}
          postId={postId}
          label="Resume"
          busyLabel="Resuming…"
        />
      ) : null}

      {['scheduled', 'paused', 'pending_approval', 'failed'].includes(status) ? (
        <ActionButton
          action={cancelPostAction}
          postId={postId}
          label="Cancel"
          busyLabel="Cancelling…"
          variant="ghost"
        />
      ) : null}

      {status === 'draft' ? (
        <ActionButton
          action={deleteDraftAction}
          postId={postId}
          label="Delete draft"
          busyLabel="Deleting…"
          variant="ghost"
        />
      ) : null}

      {status === 'published' ? (
        <RemovePublished postId={postId} platforms={platforms} />
      ) : null}
    </div>
  )
}
