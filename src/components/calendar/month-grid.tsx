'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { reschedulePostsAction } from '@/lib/posts/actions'
import { cn } from '@/lib/utils'
import type { FormState } from '@/lib/forms'
import type { Platform, PostStatus } from '@/lib/constants'
import { DayPanel } from './day-panel'

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
  /** Deduplicated, for the day panel. Absent on views that do not fetch them. */
  platforms?: Platform[]
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
  highlight,
  timeZone,
  canWrite,
}: {
  posts: GridPost[]
  cells: GridCell[]
  today: string
  weekdays: string[]
  /** A post just saved elsewhere, to point at. */
  highlight?: string | null
  timeZone: string
  canWrite: boolean
}) {
  /** `postId -> new dayKey`, held until saved. */
  const [moves, setMoves] = useState<Record<string, string>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)

  /** The tile that is open, and the post inside it that is open. */
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [openPost, setOpenPost] = useState<string | null>(null)

  /**
   * The day whose contents are still on screen.
   *
   * It lags `openDay` on the way out. Unmounting the panel the instant it is
   * closed would empty the column and then collapse an empty box, which reads
   * as two events; keeping the contents until the column has finished closing
   * makes it one.
   *
   * A timer rather than `transitionend`, because there is no transition to
   * listen for below the `lg` breakpoint or for a reader who has asked for
   * less motion — and a panel that waits for an event that never fires would
   * simply never close.
   */
  const [shownDay, setShownDay] = useState<string | null>(null)
  const closeTimer = useRef<number | null>(null)

  function openTile(dayKey: string, postId: string | null = null) {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    setShownDay(dayKey)
    setOpenDay(dayKey)
    setOpenPost(postId)
  }

  function closeTile() {
    setOpenDay(null)
    setOpenPost(null)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    // Matches the column's 280ms. Being a little late costs nothing; being
    // early puts a gap in the middle of the animation.
    closeTimer.current = window.setTimeout(() => setShownDay(null), 300)
  }

  useEffect(
    () => () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    },
    [],
  )

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

      {/* Grid on the left, open day on the right.

          The two are siblings in one grid rather than the panel being stacked
          underneath, so the month stays in view while a day is being read —
          which is the whole reason for opening one. A month you cannot see is
          a month you cannot compare the day against.

          Below `lg` they stack anyway: side by side at phone width would give
          the calendar about 180 pixels for seven columns. */}
      <div className="motif-calendar" data-open={openDay ? 'true' : 'false'}>
        {/* --- the grid ---

            Tiles with a gap rather than cells sharing borders. The gap is what
            makes a day feel like a thing you can press, and pressing one is now
            how you get at its posts. */}
        <div className="min-w-0 space-y-1.5">
        <div className="grid grid-cols-7 gap-1.5">
          {weekdays.map((day) => (
            <div key={day} className="py-1 text-center text-xs font-medium text-muted-foreground">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
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
                onClick={(event) => {
                  // A click that landed on a post is that post's business —
                  // the post opens the day *and* itself, and does so through
                  // its own handler.
                  if (!cell.key) return
                  if ((event.target as HTMLElement).closest('[data-post]')) return
                  if (openDay === cell.key) closeTile()
                  else openTile(cell.key)
                }}
                className={cn(
                  'min-h-24 rounded-[var(--radius)] border p-1.5 text-left transition-colors',
                  cell.key
                    ? 'cursor-pointer border-border bg-surface hover:border-muted-foreground/40'
                    : 'border-transparent bg-surface-muted/30',
                  isToday && 'border-primary/50',
                  openDay === cell.key && cell.key && 'border-primary ring-2 ring-primary/30',
                  over === cell.key && cell.key && 'bg-primary/10 ring-2 ring-primary/40',
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
                              data-post
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
                                // The one just saved in the composer. Held
                                // until the next render rather than faded out
                                // on a timer — somebody who looks away and
                                // back should still find it.
                                post.id === highlight && !moved && 'bg-primary/15 ring-1 ring-primary',
                              )}
                            >
                              <span
                                className={cn('size-1.5 shrink-0 rounded-full', DOT[post.status] ?? 'bg-muted-foreground')}
                                aria-hidden
                              />
                              <span className="shrink-0 text-muted-foreground">{post.time}</span>
                              {/* Opens the day beneath the grid rather than
                                  navigating. The post is two lines of six-point
                                  text here; the panel is where it is legible,
                                  and where it can be changed. */}
                              <button
                                type="button"
                                draggable={false}
                                onClick={() => openTile(post.dayKey, post.id)}
                                className="truncate text-left hover:underline"
                              >
                                {post.caption.trim() || 'Untitled'}
                              </button>
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

        {/* `overflow-hidden` is what lets the column be 0 wide without its
            contents spilling across the grid; the panel keeps its own width
            inside, so it is revealed rather than squashed and re-flowed.

            Sticky, so a long month scrolled past does not carry the day out of
            view with it. */}
        {shownDay ? (
          <div className="lg:sticky lg:top-6 lg:overflow-hidden">
            <DayPanel
              className="motif-panel lg:w-[22rem]"
              heading={headingFor(shownDay)}
              posts={(placed.get(shownDay) ?? []).map((post) => ({
                ...post,
                platforms: post.platforms ?? [],
                scheduledLocal: `${post.dayKey}T${post.clock}`,
              }))}
              timeZone={timeZone}
              today={today}
              canWrite={canWrite}
              openPost={openPost}
              onOpenPost={setOpenPost}
              onClose={closeTile}
            />
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Press a day to open it. Drag a post to another day to move it, or onto
        another post to swap the two — the time of day stays with the post, and
        nothing is saved until you say so.
      </p>
    </div>
  )
}

/**
 * "Friday, 25 September 2026".
 *
 * Built in UTC on purpose: this names a date, not an instant. Formatting
 * `2026-09-25` in the reader's local zone would show the 24th to anybody west
 * of Greenwich.
 */
function headingFor(dayKey: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dayKey}T00:00:00Z`))
}
