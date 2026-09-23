'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { ChevronDown, ExternalLink, Plus, X } from 'lucide-react'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/components/posts/status-badge'
import { quickEditPostAction } from '@/lib/posts/actions'
import { PLATFORM_LABELS, type Platform } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import { EMPTY_FORM_STATE } from '@/lib/forms'
import { cn } from '@/lib/utils'
import type { GridPost } from './month-grid'

/**
 * A day, opened.
 *
 * The month grid is a shape: thirty tiles, some busier than others. Reading it
 * is how you notice that Thursday is empty and Friday has four. But the moment
 * you want to *do* something about that, the tile is too small — six point
 * type, a truncated caption, and the nearest real answer a page away.
 *
 * So the tile opens into this, and a post inside it opens again into an editor.
 * Two taps from "the month looks wrong" to "the caption is fixed", without ever
 * leaving the month.
 *
 * ### What the editor deliberately leaves out
 *
 * Caption and time, and nothing else. Media and accounts are the parts of a
 * post that need room — a picker, an uploader, per-platform validation with
 * something to look at — and cramming them into a panel this size would make
 * both this and the composer worse. Every post links to the full composer for
 * those. `quickEditPostAction` applies exactly the same rules either way, so
 * the short form is not a weaker form.
 */

export type PanelPost = GridPost & {
  platforms: Platform[]
  /** Wall-clock `YYYY-MM-DDTHH:mm` in the workspace zone, for the picker. */
  scheduledLocal: string
}

export function DayPanel({
  className,
  heading,
  posts,
  timeZone,
  today,
  canWrite,
  openPost,
  onOpenPost,
  onClose,
}: {
  className?: string
  /** "Friday, 25 September 2026". */
  heading: string
  posts: PanelPost[]
  timeZone: string
  today: string
  canWrite: boolean
  /** Controlled by the grid, so tapping a chip opens straight to that post. */
  openPost: string | null
  onOpenPost: (id: string | null) => void
  onClose: () => void
}) {
  return (
    <section
      aria-label={heading}
      className={cn(
        // No drop shadow: the panel sits beside the grid rather than over it,
        // and a shadow would be clipped by the column that reveals it.
        'rounded-[var(--radius)] border border-primary/40 bg-surface',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{heading}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {posts.length === 0
              ? 'Nothing scheduled.'
              : `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}.`}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close this day"
          className="rounded-[var(--radius)] p-1.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <ul className="divide-y divide-border">
        {posts.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing is going out on this day.
          </li>
        ) : null}

        {posts.map((post) => (
          <li key={post.id}>
            <button
              type="button"
              onClick={() => onOpenPost(openPost === post.id ? null : post.id)}
              aria-expanded={openPost === post.id}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted"
            >
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {post.time}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {post.caption.trim() || (
                    <span className="text-muted-foreground italic">No caption</span>
                  )}
                </span>
                {post.platforms.length > 0 ? (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {post.platforms.map((p) => PLATFORM_LABELS[p]).join(', ')}
                  </span>
                ) : null}
              </span>

              <StatusBadge status={post.status} />

              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform',
                  openPost === post.id && 'rotate-180',
                )}
                aria-hidden
              />
            </button>

            {openPost === post.id ? (
              <PostEditor post={post} timeZone={timeZone} today={today} canWrite={canWrite} />
            ) : null}
          </li>
        ))}
      </ul>

      {canWrite ? (
        <div className="border-t border-border px-4 py-3">
          <Link
            href={`${ROUTES.posts}/new`}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <Plus className="size-3.5" aria-hidden />
            Write one for this day
          </Link>
        </div>
      ) : null}
    </section>
  )
}

/**
 * The post, editable in place.
 *
 * Locked posts render read-only rather than being hidden: "this is going out
 * right now" is the most useful thing the panel can say about a post somebody
 * has just tapped, and an empty space says nothing.
 */
function PostEditor({
  post,
  timeZone,
  today,
  canWrite,
}: {
  post: PanelPost
  timeZone: string
  today: string
  canWrite: boolean
}) {
  const [state, action, pending] = useActionState(quickEditPostAction, EMPTY_FORM_STATE)

  const [caption, setCaption] = useState(post.caption)
  const [scheduledLocal, setScheduledLocal] = useState(post.scheduledLocal)

  const locked =
    !canWrite ||
    post.status === 'publishing' ||
    ['published', 'removed', 'cancelled'].includes(post.status)

  return (
    <form action={action} className="space-y-3 border-t border-border bg-surface-muted/40 px-4 py-3">
      <input type="hidden" name="postId" value={post.id} />

      {state.error ? (
        <p className="rounded-[var(--radius)] border border-danger/40 bg-danger/5 px-3 py-2 text-sm">
          {state.error}
        </p>
      ) : null}

      {state.notice ? (
        <p className="rounded-[var(--radius)] border border-success/40 bg-success/5 px-3 py-2 text-sm">
          {state.notice}
        </p>
      ) : null}

      {post.status === 'publishing' ? (
        <p className="text-xs text-muted-foreground">
          This post is going out right now, so it is locked until publishing
          finishes.
        </p>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-xs font-medium">Caption</span>
        <Textarea
          name="caption"
          rows={4}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          disabled={locked}
        />
      </label>

      <div className="space-y-1.5">
        <span className="block text-xs font-medium">Goes out</span>
        <DateTimePicker
          name="scheduledLocal"
          value={scheduledLocal}
          onChange={setScheduledLocal}
          timeZone={timeZone}
          today={today}
          disabled={locked}
          invalid={Boolean(state.fieldErrors?.scheduledLocal)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <Link
          href={`${ROUTES.posts}/${post.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          Media, accounts and the rest
        </Link>

        {locked ? null : (
          <button
            type="submit"
            disabled={pending}
            className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </form>
  )
}
