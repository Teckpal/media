'use client'

import { useActionState, useMemo, useState } from 'react'
import { MediaUploader, type ComposerMedia } from './media-uploader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, describedBy } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { savePostAction } from '@/lib/posts/actions'
import { validatePost } from '@/lib/posts/validation'
import { EMPTY_FORM_STATE } from '@/lib/forms'
import { PLATFORM_LABELS, type Platform } from '@/lib/constants'
import { cn } from '@/lib/utils'

export type TargetOption = {
  id: string
  platform: Platform
  name: string
  /** Section 7.2: an account with no paid seat can hold drafts only. */
  paidSeat: boolean
  needsReconnect: boolean
}

export type ComposerDefaults = {
  postId?: string
  caption: string
  media: ComposerMedia[]
  accountIds: string[]
  /** Wall-clock in the workspace zone, for `datetime-local`. */
  scheduledLocal: string
}

export function Composer({
  workspaceId,
  timezone,
  targets,
  defaults,
  /** Section 6.2: a post being published is locked. */
  locked,
  canSchedule,
  scheduleBlockReason,
  mustReschedule,
}: {
  workspaceId: string
  timezone: string
  targets: TargetOption[]
  defaults: ComposerDefaults
  locked: boolean
  canSchedule: boolean
  scheduleBlockReason: string | null
  mustReschedule: boolean
}) {
  const [state, action, pending] = useActionState(savePostAction, EMPTY_FORM_STATE)

  const [caption, setCaption] = useState(defaults.caption)
  const [media, setMedia] = useState<ComposerMedia[]>(defaults.media)
  const [selected, setSelected] = useState<string[]>(defaults.accountIds)
  const [scheduledLocal, setScheduledLocal] = useState(
    // Section 6.2: a resumed post whose time has passed must pick a new one,
    // so the old value is cleared rather than offered back.
    mustReschedule ? '' : defaults.scheduledLocal,
  )

  const chosenPlatforms = useMemo(
    () =>
      targets.filter((t) => selected.includes(t.id)).map((t) => t.platform),
    [targets, selected],
  )

  // The same pure validator the server runs, so the composer can say what is
  // wrong before anything is submitted — and cannot disagree with the refusal
  // that follows if it is.
  const issues = useMemo(
    () => validatePost(chosenPlatforms, { caption, media }),
    [chosenPlatforms, caption, media],
  )

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const fieldErrors = state.fieldErrors ?? {}

  function toggleTarget(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const blocked = errors.length > 0 || selected.length === 0

  return (
    <form action={action} className="space-y-6">
      {defaults.postId ? (
        <input type="hidden" name="postId" value={defaults.postId} />
      ) : null}
      {media.map((m) => (
        <input key={m.id} type="hidden" name="mediaId" value={m.id} />
      ))}
      {selected.map((id) => (
        <input key={id} type="hidden" name="accountId" value={id} />
      ))}

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}

      {locked ? (
        <Alert tone="warning" title="This post is going out right now">
          It is locked until publishing finishes.
        </Alert>
      ) : null}

      {mustReschedule ? (
        <Alert tone="warning" title="Pick a new time">
          The time this post was paused at has already passed, so it needs a new
          one before it can be scheduled again.
        </Alert>
      ) : null}

      <Field label="Caption" htmlFor="caption" error={fieldErrors.caption}>
        <Textarea
          id="caption"
          name="caption"
          rows={7}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          disabled={locked}
          aria-invalid={errors.some((i) => i.field === 'caption')}
          aria-describedby={describedBy('caption', { error: fieldErrors.caption })}
          placeholder="What do you want to say?"
        />
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">Media</p>
        <MediaUploader
          workspaceId={workspaceId}
          media={media}
          onChange={setMedia}
          disabled={locked}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Post to</legend>

        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is connected yet.
          </p>
        ) : (
          targets.map((target) => {
            const checked = selected.includes(target.id)

            return (
              <label
                key={target.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border p-3 transition-colors',
                  checked
                    ? 'border-primary bg-surface-muted'
                    : 'border-border bg-surface hover:bg-surface-muted',
                  locked && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  onChange={() => toggleTarget(target.id)}
                  className="size-4 accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{target.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {PLATFORM_LABELS[target.platform]}
                    {target.needsReconnect ? ' · needs reconnecting' : null}
                    {!target.paidSeat ? ' · unpaid, drafts only' : null}
                  </span>
                </span>
              </label>
            )
          })
        )}
      </fieldset>

      {errors.length > 0 ? (
        <Alert tone="danger" title="This will not publish as it is">
          <ul className="list-disc space-y-1 pl-4">
            {errors.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {warnings.length > 0 ? (
        <Alert tone="warning" title="Worth knowing">
          <ul className="list-disc space-y-1 pl-4">
            {warnings.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card className="space-y-4">
        <Field
          label="Schedule for"
          htmlFor="scheduledLocal"
          hint={`Times are in ${timezone}. Leave empty to keep this as a draft.`}
          error={fieldErrors.scheduledLocal}
        >
          <Input
            id="scheduledLocal"
            name="scheduledLocal"
            type="datetime-local"
            value={scheduledLocal}
            onChange={(e) => setScheduledLocal(e.target.value)}
            disabled={locked || !canSchedule}
            aria-invalid={Boolean(fieldErrors.scheduledLocal)}
            aria-describedby={describedBy('scheduledLocal', {
              error: fieldErrors.scheduledLocal,
              hint: true,
            })}
          />
        </Field>

        {/* Gate 2 from Section 4. The input above is disabled as a courtesy;
            the server refuses regardless, for the exact accounts chosen. */}
        {scheduleBlockReason ? (
          <Alert tone="warning" title="Scheduling is locked">
            {scheduleBlockReason}
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" disabled={locked || pending || blocked}>
            {pending
              ? 'Saving…'
              : scheduledLocal
                ? 'Schedule'
                : 'Save draft'}
          </Button>

          {/* A submit with its own name, not an onClick that clears state —
              React would not have re-rendered before the form was posted, so
              the old time would go with it. The server reads this instead. */}
          {scheduledLocal ? (
            <Button
              type="submit"
              name="saveAsDraft"
              value="1"
              variant="secondary"
              size="lg"
              disabled={locked || pending || blocked}
            >
              Save as draft instead
            </Button>
          ) : null}
        </div>
      </Card>
    </form>
  )
}
