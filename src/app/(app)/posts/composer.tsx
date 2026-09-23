'use client'

import { useActionState, useMemo, useState } from 'react'
import { MediaUploader, type ComposerMedia } from './media-uploader'
import { Button } from '@/components/ui/button'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Textarea } from '@/components/ui/textarea'
import { Field, describedBy } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { savePostAction } from '@/lib/posts/actions'
import { validatePost } from '@/lib/posts/validation'
import { EMPTY_FORM_STATE } from '@/lib/forms'
import { PreviewTabs } from '@/components/posts/preview-tabs'
import { HashtagPicker } from '@/components/posts/hashtag-picker'
import { PLATFORM_LABELS, type Platform } from '@/lib/constants'
import type { HashtagProfile } from '@/lib/posts/hashtags'
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
  today,
  profile,
}: {
  workspaceId: string
  timezone: string
  /** The workspace's own today, `YYYY-MM-DD`. Read on the server, in its zone. */
  today: string
  targets: TargetOption[]
  defaults: ComposerDefaults
  locked: boolean
  canSchedule: boolean
  scheduleBlockReason: string | null
  mustReschedule: boolean
  /** Section 10's brand profile, for hashtag suggestions. Null until set up. */
  profile: HashtagProfile | null
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
    /**
     * Writing on the left, preview on the right.
     *
     * The preview's whole job is to be looked at *while* the caption is being
     * typed — that is what makes a fold or a crop something you notice rather
     * than something you find out about afterwards. Below the form it was a
     * scroll away from the textarea, which is the same as not being there.
     *
     * One form still, not two columns of separate forms: every field below
     * posts together, and the hidden inputs carrying media and accounts have to
     * travel with them.
     */
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      {defaults.postId ? (
        <input type="hidden" name="postId" value={defaults.postId} />
      ) : null}
      {media.map((m) => (
        <input key={m.id} type="hidden" name="mediaId" value={m.id} />
      ))}
      {selected.map((id) => (
        <input key={id} type="hidden" name="accountId" value={id} />
      ))}

      <div className="min-w-0 space-y-6">
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

      <HashtagPicker
        caption={caption}
        platforms={chosenPlatforms}
        profile={profile}
        disabled={locked}
        onAppend={(tag) =>
          setCaption((current) => {
            // Appended, never inserted at the cursor. A caption is prose and a
            // tag block is not part of it; dropping #SpringCollection into the
            // middle of a sentence is never what was meant.
            const trimmed = current.replace(/\s+$/, '')
            const separator = trimmed.length === 0 ? '' : trimmed.endsWith('#') ? '' : ' '
            return `${trimmed}${separator}#${tag}`
          })
        }
      />

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
          <DateTimePicker
            id="scheduledLocal"
            name="scheduledLocal"
            value={scheduledLocal}
            onChange={setScheduledLocal}
            timeZone={timezone}
            today={today}
            disabled={locked || !canSchedule}
            invalid={Boolean(fieldErrors.scheduledLocal)}
            describedBy={describedBy('scheduledLocal', {
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

        {/* Three buttons, each a submit with its own name, because the name is
            the instruction. An onClick that cleared the time field first would
            not have re-rendered before the form posted, and the stale value
            would go with it — so the server reads which button was pressed
            instead of inferring intent from the fields. */}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" disabled={locked || pending || blocked}>
            {pending ? 'Saving…' : scheduledLocal ? 'Schedule' : 'Save draft'}
          </Button>

          {/* Straight out, no time chosen. The server treats it as a schedule
              of zero length, so it meets the same publish gate, the same
              per-platform validation and the same approvals rule — the button
              is a shortcut, never a way round any of them. */}
          <Button
            type="submit"
            name="publishNow"
            value="1"
            variant="secondary"
            size="lg"
            disabled={locked || pending || blocked || !canSchedule}
            title={
              canSchedule ? undefined : (scheduleBlockReason ?? 'Publishing is locked.')
            }
          >
            Post now
          </Button>

          {scheduledLocal ? (
            <Button
              type="submit"
              name="saveAsDraft"
              value="1"
              variant="ghost"
              size="lg"
              disabled={locked || pending || blocked}
            >
              Save as draft instead
            </Button>
          ) : null}
        </div>
      </Card>
      </div>

      {/* Sticky, so it stays beside the caption however far the form is
          scrolled. On a narrow screen the grid collapses and this simply
          follows the fields, which is the only place it can go. */}
      <div className="lg:sticky lg:top-6">
        <PreviewTabs
          targets={targets.filter((t) => selected.includes(t.id))}
          caption={caption}
          media={media}
          // Absent while the post is locked, which is what makes the preview
          // read-only without it needing to know why.
          onCaptionChange={locked ? undefined : setCaption}
        />
      </div>
    </form>
  )
}
