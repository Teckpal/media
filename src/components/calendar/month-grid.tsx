'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { reschedulePostsAction } from '@/lib/posts/actions'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/lib/routes'
import type { FormState } from '@/lib/forms'
import type { PostStatus } from '@/lib/constants'

/**
 * The month, with the posts moveable between days.
 *
 * Drag a post onto another day and it moves there, keeping the time of day it
 * already had — a 9am post dropped on Thursday is a 9am Thursday post, because
 * the time was a decision and the day was the thing being changed. Drop it onto
 * another post and the two exchange slots, which is the case the drag exists
 * for: two posts written in the wrong order.
 *
 * NOTHING IS SAVED BY DRAGGING. A grid where letting go of the mouse writes to
 * the database is a grid where a mis-drop is a published post at the wrong
 * hour. Moves are held, shown as pending, and written only when asked for — so
 * the undo is free until then.
 *
 * The rules are re-checked on the server (`reschedulePostsAction`) and again by
 * the database. What is enforced here is only what makes the grid pleasant:
 * a post that is publishing does not lift, and a drop into the past is refused
 * before it can be queued.
 */

export type GridPost = {
  id: string
  caption: string
  status: PostStatus
  /** `YYYY-MM-DD` in the workspace's zone. */
  dayKey: string
  /** `HH:mm` in the workspace's zone — kept when the day changes. */
  clock: string
  /** Formatted for reading, e.g. "9:00 am". */
  time: string
}

export type GridCell = { day: number; key: string | null }

const DOT: Partial<Record<PostStatus, string>> = {
  draft: 'bg-muted-foreground',
  pending_approval: 'bg-warning',
  scheduled: 'bg-primary',
  publishing: 'bg-primary',
  published: 'bg-success',
  paused: 'bg-warning',
  failed: 'bg-danger',
}

/** Section 6.2: these are locked, and the grid should not pretend otherwise. */
function isMovable(post: GridPost): boolean {
  return post.status !== 'publishing' && post.status !== 'published'
}

export function MonthGrid({
  posts,
  cells,
  today,
  weekdays,
}: {
  posts: GridPost[]
  cells: GridCell[]
  today: string
  weekdays: string[]
}) {
  /** `postId -> new dayKey`, held until saved. */
  const [moves, setMoves] = useState<Record<string, string>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)

  const [state, save, saving] = useActionState<FormState, FormData>(
    reschedulePostsAction,
    { error: null },
  )

  const byId = useMemo(() => new Map(posts.map((post) => [post.id, post])), [posts])

  /**
   * The moves that still mean something.
   *
   * A saved move is not cleared by hand. The action revalidates the page, the
   * posts come back on their new days, and every pending entry then points at
   * the day its post is already on — so it stops counting here and the prompt
   * goes away on its own. Deriving that beats an effect that watches for a
   * success notice and resets state behind React's back.
   */
  const pending = useMemo(
    () =>
      Object.entries(moves).filter(([postId, dayKey]) => {
        const post = byId.get(postId)
        return post !== undefined && post.dayKey !== dayKey
      }),
    [moves, byId],
  )

  const effective = useMemo(() => Object.fromEntries(pending), [pending])
  const dirty = pending.length > 0

  /** Posts as they would be once the pending moves are saved. */
  const placed = useMemo(() => {
    const map = new Map<string, GridPost[]>()
    for (const post of posts) {
      const key = effective[post.id] ?? post.dayKey
      map.set(key, [...(map.get(key) ?? []), { ...post, dayKey: key }])
    }
    for (const list of map.values()) list.sort((a, b) => a.clock.localeCompare(b.clock))
    return map
  }, [posts, effective])

  function refuse(message: string) {
    setRefused(message)
    window.setTimeout(() => setRefused(null), 4000)
  }

  function place(postId: string, dayKey: string) {
    const post = byId.get(postId)
    if (!post) return

    if (post.status === 'scheduled' && dayKey < today) {
      refuse('A scheduled post cannot be moved into the past.')
      return
    }

    setMoves((current) => {
      const next = { ...current }
      if (dayKey === post.dayKey) delete next[postId]
      else next[postId] = dayKey
      return next
    })
  }

  /** The two exchange days. A swap is the reason this grid can be dragged at all. */
  function swap(aId: string, bId: string) {
    const a = byId.get(aId)
    const b = byId.get(bId)
    if (!a || !b || aId === bId) return
    if (!isMovable(b)) {
      refuse('That post is locked and cannot be swapped.')
      return
    }

    const aDay = effective[aId] ?? a.dayKey
    const bDay = effective[bId] ?? b.dayKey
    if (aDay === bDay) return

    if ((a.status === 'scheduled' && bDay < today) || (b.status === 'scheduled' && aDay < today)) {
      refuse('That swap would put a scheduled post in the past.')
      return
    }

    setMoves((current) => {
      const next = { ...current }
      const set = (id: string, day: string, home: string) => {
        if (day === home) delete next[id]
        else next[id] = day
      }
      set(aId, bDay, a.dayKey)
      set(bId, aDay, b.dayKey)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {/* --- the save prompt, after every change --- */}
      {dirty ? (
        <form
          action={save}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-primary/40 bg-primary/5 px-4 py-3"
        >
          <input
            type="hidden"
            name="moves"
            value={JSON.stringify(
              pending.map(([postId, dayKey]) => ({
                postId,
                // The clock is the post's own, so a move keeps its hour.
                scheduledAt: `${dayKey}T${byId.get(postId)?.clock ?? '09:00'}`,
              })),
            )}
          />

          <p className="text-sm">
            <span className="font-medium">
              {pending.length} unsaved {pending.length === 1 ? 'move' : 'moves'}.
            </span>{' '}
            <span className="text-muted-foreground">
              Nothing has changed until you save.
            </span>
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMoves({})}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Undo all
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              <Check className="size-3.5" aria-hidden />
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      ) : null}

      {state.error ? (
        <p role="alert" className="rounded-[var(--radius)] border border-danger/40 bg-danger-subtle px-4 py-2.5 text-sm">
          {state.error}
        </p>
      ) : null}

      {refused ? (
        <p role="status" className="rounded-[var(--radius)] border border-warning/40 bg-warning-subtle px-4 py-2.5 text-sm">
          {refused}
        </p>
      ) : null}

      {/* --- the grid --- */}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border">
          {weekdays.map((day) => (
            <div key={day} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell, index) => {
            const dayPosts = cell.key ? (placed.get(cell.key) ?? []) : []
            const isToday = cell.key === today

            return (
              <div
                key={index}
                onDragOver={(event) => {
                  if (!cell.key || !dragging) return
                  event.preventDefault()
                  setOver(cell.key)
                }}
                onDragLeave={() => setOver((current) => (current === cell.key ? null : current))}
                onDrop={(event) => {
                  event.preventDefault()
                  setOver(null)
                  const postId = event.dataTransfer.getData('text/post-id')
                  if (postId && cell.key) place(postId, cell.key)
                }}
                className={cn(
                  'min-h-24 border-r border-b border-border p-1.5',
                  !cell.key && 'bg-surface-muted/40',
                  index % 7 === 6 && 'border-r-0',
                  over === cell.key && cell.key && 'bg-primary/10 ring-2 ring-inset ring-primary/40',
                )}
              >
                {cell.key ? (
                  <>
                    <span
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full text-xs',
                        isToday ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {cell.day}
                    </span>

                    <ul className="mt-1 space-y-1">
                      {dayPosts.map((post) => {
                        const moved = Boolean(effective[post.id])
                        const movable = isMovable(post)

                        return (
                          <li key={post.id}>
                            <div
                              draggable={movable}
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/post-id', post.id)
                                event.dataTransfer.effectAllowed = 'move'
                                setDragging(post.id)
                              }}
                              onDragEnd={() => {
                                setDragging(null)
                                setOver(null)
                              }}
                              onDragOver={(event) => {
                                // Let a drop onto a post mean "swap", not "move
                                // to this day" — so stop the cell seeing it.
                                if (!dragging || dragging === post.id) return
                                event.preventDefault()
                                event.stopPropagation()
                              }}
                              onDrop={(event) => {
                                const sourceId = event.dataTransfer.getData('text/post-id')
                                if (!sourceId || sourceId === post.id) return
                                event.preventDefault()
                                event.stopPropagation()
                                setOver(null)
                                swap(sourceId, post.id)
                              }}
                              className={cn(
                                'group flex items-center gap-1.5 rounded px-1 py-0.5 text-xs',
                                movable ? 'cursor-grab active:cursor-grabbing hover:bg-surface-muted' : 'opacity-70',
                                dragging === post.id && 'opacity-40',
                                moved && 'bg-primary/10 ring-1 ring-primary/40',
                              )}
                            >
                              <span
                                className={cn('size-1.5 shrink-0 rounded-full', DOT[post.status] ?? 'bg-muted-foreground')}
                                aria-hidden
                              />
                              <span className="shrink-0 text-muted-foreground">{post.time}</span>
                              <Link
                                href={`${ROUTES.posts}/${post.id}`}
                                // Dragging a link drags the URL unless this is
                                // taken over by the row above it.
                                draggable={false}
                                className="truncate hover:underline"
                              >
                                {post.caption.trim() || 'Untitled'}
                              </Link>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Drag a post to another day to move it, or onto another post to swap the
        two. The time of day stays with the post. Nothing is saved until you say so.
      </p>
    </div>
  )
}
