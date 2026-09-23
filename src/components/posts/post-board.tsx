'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState } from 'react'
import { Lock, Plus } from 'lucide-react'
import { pausePostAction, resumePostAction } from '@/lib/posts/actions'
import { PLATFORM_LABELS, type Platform, type PostStatus } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import { cn } from '@/lib/utils'
import { EMPTY_FORM_STATE } from '@/lib/forms'

/**
 * Posts as columns, by where they are in their life.
 *
 * The list answers "what have we got"; this answers "what is stuck". A column
 * with eleven drafts and nothing scheduled is a sentence about the week, and
 * it is not one a sorted list ever says out loud.
 *
 * ### Why most of it does not drag
 *
 * A board invites you to drag between any two columns, and Section 6.2's state
 * machine does not allow that. Dragging a draft into Scheduled would need a
 * time, which the board has nowhere to ask for; dragging anything into
 * Published would be a lie, since only the platform decides that; and
 * `publishing` is locked outright.
 *
 * So exactly one move is offered, and it is the one that needs no extra
 * information and is genuinely useful mid-week: **Scheduled ⇄ Paused**. Every
 * other column says plainly that it does not take drops, rather than accepting
 * one and then refusing it. A board that lets you drop something and then
 * shrugs is worse than one that does not let you.
 *
 * Everything else is a link to the post, where the actions that need context
 * live.
 */

export type BoardPost = {
  id: string
  caption: string
  status: PostStatus
  /** Already formatted in the workspace's zone. */
  when: string | null
  platforms: Platform[]
}

type ColumnKey = 'draft' | 'pending_approval' | 'scheduled' | 'paused' | 'published' | 'failed'

const COLUMNS: {
  key: ColumnKey
  label: string
  statuses: PostStatus[]
  blurb: string
  accent: string
}[] = [
  {
    key: 'draft',
    label: 'Draft',
    statuses: ['draft'],
    blurb: 'Written, no time on it yet.',
    accent: 'bg-muted-foreground',
  },
  {
    key: 'pending_approval',
    label: 'Waiting on approval',
    statuses: ['pending_approval'],
    blurb: 'An admin has to say yes.',
    accent: 'bg-warning',
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    statuses: ['scheduled', 'publishing'],
    blurb: 'Going out at its time.',
    accent: 'bg-primary',
  },
  {
    key: 'paused',
    label: 'Paused',
    statuses: ['paused'],
    blurb: 'Held back. Keeps its time.',
    accent: 'bg-warning',
  },
  {
    key: 'published',
    label: 'Published',
    statuses: ['published'],
    blurb: 'Live on the platform.',
    accent: 'bg-success',
  },
  {
    key: 'failed',
    label: 'Needs attention',
    statuses: ['failed'],
    blurb: 'Did not go out.',
    accent: 'bg-danger',
  },
]

/** The only drag the state machine allows without asking for anything more. */
const DROPPABLE: Partial<Record<ColumnKey, PostStatus[]>> = {
  scheduled: ['paused'],
  paused: ['scheduled'],
}

export function PostBoard({ posts, canWrite }: { posts: BoardPost[]; canWrite: boolean }) {
  const [dragging, setDragging] = useState<BoardPost | null>(null)
  const [pause, pauseAction, pausing] = useActionState(pausePostAction, EMPTY_FORM_STATE)
  const [resume, resumeAction, resuming] = useActionState(resumePostAction, EMPTY_FORM_STATE)

  const columns = useMemo(
    () =>
      COLUMNS.map((column) => ({
        ...column,
        posts: posts.filter((post) => column.statuses.includes(post.status)),
      })),
    [posts],
  )

  const error = pause.error ?? resume.error
  const busy = pausing || resuming

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-[var(--radius)] border border-danger/40 bg-danger/5 px-4 py-2.5 text-sm">
          {error}
        </p>
      ) : null}

      {/* Two hidden forms rather than one per card. A board with sixty posts
          would otherwise carry sixty forms, and only ever submit one. */}
      <form action={pauseAction} id="board-pause" className="hidden">
        <input type="hidden" name="postId" value={dragging?.id ?? ''} readOnly />
      </form>
      <form action={resumeAction} id="board-resume" className="hidden">
        <input type="hidden" name="postId" value={dragging?.id ?? ''} readOnly />
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {columns.map((column) => {
          const takes = canWrite ? (DROPPABLE[column.key] ?? []) : []
          const willTake = dragging !== null && takes.includes(dragging.status)

          return (
            <section
              key={column.key}
              onDragOver={(event) => {
                if (!willTake) return
                event.preventDefault()
              }}
              onDrop={(event) => {
                if (!willTake || !dragging) return
                event.preventDefault()

                // Submitting the hidden form rather than calling the action
                // directly, so `useActionState` owns the pending and error
                // state exactly as it does everywhere else in the app.
                const form = document.getElementById(
                  column.key === 'paused' ? 'board-pause' : 'board-resume',
                ) as HTMLFormElement | null

                form?.requestSubmit()
                setDragging(null)
              }}
              className={cn(
                'flex flex-col rounded-[var(--radius)] border bg-surface transition-colors',
                willTake ? 'border-primary ring-2 ring-primary/30' : 'border-border',
              )}
            >
              <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-sm font-medium">
                    <span className={cn('size-1.5 rounded-full', column.accent)} aria-hidden />
                    {column.label}
                    <span className="text-muted-foreground">{column.posts.length}</span>
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{column.blurb}</p>
                </div>

                {/* Said on the column, not discovered by trying. */}
                {dragging && !willTake ? (
                  <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
              </header>

              <ul className="flex-1 space-y-2 p-3">
                {column.posts.length === 0 ? (
                  <li className="py-6 text-center text-xs text-muted-foreground">Nothing here.</li>
                ) : (
                  column.posts.map((post) => {
                    const movable =
                      canWrite && (post.status === 'scheduled' || post.status === 'paused')

                    return (
                      <li key={post.id}>
                        <div
                          draggable={movable && !busy}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move'
                            setDragging(post)
                          }}
                          onDragEnd={() => setDragging(null)}
                          className={cn(
                            'rounded-[var(--radius)] border border-border bg-surface-muted/50 p-3 transition-colors hover:border-muted-foreground/40',
                            movable && 'cursor-grab active:cursor-grabbing',
                            dragging?.id === post.id && 'opacity-40',
                          )}
                        >
                          <Link href={`${ROUTES.posts}/${post.id}`} draggable={false}>
                            <p className="line-clamp-2 text-sm">
                              {post.caption.trim() || (
                                <span className="text-muted-foreground italic">No caption</span>
                              )}
                            </p>

                            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                              {post.when ? <span>{post.when}</span> : null}
                              {post.platforms.length > 0 ? (
                                <span className="truncate">
                                  {post.platforms.map((p) => PLATFORM_LABELS[p]).join(', ')}
                                </span>
                              ) : null}
                            </p>
                          </Link>
                        </div>
                      </li>
                    )
                  })
                )}

                {column.key === 'draft' && canWrite ? (
                  <li>
                    <Link
                      href={`${ROUTES.posts}/new`}
                      className="flex items-center justify-center gap-1.5 rounded-[var(--radius)] border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      <Plus className="size-3.5" aria-hidden />
                      New post
                    </Link>
                  </li>
                ) : null}
              </ul>
            </section>
          )
        })}
      </div>

      {canWrite ? (
        <p className="text-xs text-muted-foreground">
          Drag between Scheduled and Paused to hold a post back or let it go again.
          Everything else changes on the post itself, where the time and the
          accounts are.
        </p>
      ) : null}
    </div>
  )
}
