'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { reschedulePostsAction } from '@/lib/posts/actions'
import { PLATFORM_LABELS, type Platform, type PostStatus } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { FormState } from '@/lib/forms'
import type { GridPost } from './month-grid'

/**
 * The week, with the hours in it.
 *
 * The month grid answers "how busy is the month"; this answers "what is going
 * out today, and at what time" — and a scheduling product is mostly the second
 * question. A month square that says "9:00 am" in six-point type is a fact you
 * have to read. A block sitting at nine o'clock is a fact you can see.
 *
 * It is also the only view where a drag can change the *time*. On the month
 * grid a drag moves the day and keeps the hour, because a month square has no
 * hours in it to aim at. Here both are aimed at, and the drop snaps to the
 * half hour — fine enough to be useful, coarse enough to hit.
 *
 * Nothing is saved by dragging, exactly as on the month grid. Moves are held,
 * shown as pending, and written only when asked for, so a mis-drop costs
 * nothing. The rules are re-checked by `reschedulePostsAction` and again by the
 * database; what is enforced here is only what makes the grid pleasant.
 */

export type WeekPost = GridPost & {
  /** Minutes from midnight in the workspace's zone. */
  minutes: number
  platforms: Platform[]
}

export type WeekDay = {
  /** `YYYY-MM-DD` in the workspace's zone. */
  key: string
  /** "Monday". */
  name: string
  /** "15.09.2025". */
  label: string
}

/** The window the grid draws. Posts outside it are still listed, above. */
const START_HOUR = 6
const END_HOUR = 23
/** Pixels per hour. Half an hour is the snap, so this has to divide evenly. */
const HOUR_HEIGHT = 56
const SNAP_MINUTES = 30

const TONE: Partial<Record<PostStatus, string>> = {
  draft: 'bg-muted-foreground/70',
  pending_approval: 'bg-warning',
  scheduled: 'bg-primary',
  publishing: 'bg-primary',
  published: 'bg-success',
  paused: 'bg-warning/80',
  failed: 'bg-danger',
}

function isMovable(post: WeekPost): boolean {
  return post.status !== 'publishing' && post.status !== 'published'
}

export function WeekGrid({
  posts,
  days,
  today,
  /** Minutes from midnight, in the workspace's zone, or null if today is not in view. */
  nowMinutes,
  highlight,
}: {
  posts: WeekPost[]
  days: WeekDay[]
  today: string
  nowMinutes: number | null
  highlight?: string | null
}) {
  /** `postId -> "YYYY-MM-DDTHH:mm"`, held until saved. */
  const [moves, setMoves] = useState<Record<string, string>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)

  const [state, save, saving] = useActionState<FormState, FormData>(
    reschedulePostsAction,
    { error: null },
  )

  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts])

  /**
   * The moves that still mean something.
   *
   * Not cleared by hand after a save. The action revalidates, the posts come
   * back at their new times, and each pending entry then matches where its
   * post already is — so it stops counting and the prompt goes away on its
   * own. Deriving that beats an effect watching for a success notice and
   * resetting state behind React's back.
   */
  const pending = useMemo(
    () =>
      Object.entries(moves).filter(([postId, at]) => {
        const post = byId.get(postId)
        return post !== undefined && slotOf(post) !== at
      }),
    [moves, byId],
  )

  const effective = useMemo(() => Object.fromEntries(pending), [pending])
  const dirty = pending.length > 0

  /** Posts as they would be once the pending moves are saved, by day. */
  const placed = useMemo(() => {
    const map = new Map<string, WeekPost[]>()

    for (const post of posts) {
      const at = effective[post.id]
      const next = at
        ? { ...post, dayKey: at.slice(0, 10), minutes: minutesOf(at.slice(11)) }
        : post

      map.set(next.dayKey, [...(map.get(next.dayKey) ?? []), next])
    }

    for (const list of map.values()) list.sort((a, b) => a.minutes - b.minutes)
    return map
  }, [posts, effective])

  function refuse(message: string) {
    setRefused(message)
    window.setTimeout(() => setRefused((current) => (current === message ? null : current)), 4000)
  }

  function place(postId: string, dayKey: string, minutes: number) {
    const post = byId.get(postId)
    if (!post) return

    if (!isMovable(post)) {
      refuse('That post is already going out and cannot be moved.')
      return
    }

    const snapped = Math.max(0, Math.min(23 * 60 + 30, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES))
    const at = `${dayKey}T${clockOf(snapped)}`

    // Refused here as well as on the server, so the answer is immediate. The
    // server refuses it too — this is a courtesy, not the rule.
    if (post.status === 'scheduled' && isPastSlot(at, today, nowMinutes)) {
      refuse('That would put a scheduled post in the past.')
      return
    }

    setMoves((current) => ({ ...current, [postId]: at }))
  }

  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i),
    [],
  )

  /** Anything outside the drawn window, which would otherwise vanish. */
  const offGrid = useMemo(
    () =>
      posts.filter((post) => {
        const at = effective[post.id]
        const minutes = at ? minutesOf(at.slice(11)) : post.minutes
        return minutes < START_HOUR * 60 || minutes > END_HOUR * 60 + 59
      }),
    [posts, effective],
  )

  return (
    <div className="space-y-3">
      {dirty ? (
        <form
          action={save}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-primary/40 bg-primary/5 px-4 py-3"
        >
          <input
            type="hidden"
            name="moves"
            value={JSON.stringify(
              pending.map(([postId, scheduledAt]) => ({ postId, scheduledAt })),
            )}
          />

          <p className="text-sm">
            <span className="font-medium">
              {pending.length} unsaved {pending.length === 1 ? 'move' : 'moves'}.
            </span>{' '}
            <span className="text-muted-foreground">Nothing has changed until you save.</span>
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMoves({})}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] px-3 py-1.5 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Undo
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              <Check className="size-3.5" aria-hidden />
              {saving ? 'Saving…' : 'Save moves'}
            </button>
          </div>
        </form>
      ) : null}

      {state.error ? (
        <p className="rounded-[var(--radius)] border border-danger/40 bg-danger/5 px-4 py-2.5 text-sm">
          {state.error}
        </p>
      ) : null}

      {refused ? (
        <p className="rounded-[var(--radius)] border border-warning/40 bg-warning/5 px-4 py-2.5 text-sm">
          {refused}
        </p>
      ) : null}

      {offGrid.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {offGrid.length} {offGrid.length === 1 ? 'post is' : 'posts are'} outside{' '}
          {String(START_HOUR).padStart(2, '0')}:00–{END_HOUR}:59 and not shown here.{' '}
          <Link href={ROUTES.posts} className="underline">
            See them in the list
          </Link>
          .
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-surface">
        <div className="min-w-[52rem]">
          {/* --- day headings --- */}
          <div className="grid grid-cols-[4rem_repeat(7,1fr)] border-b border-border">
            <span />
            {days.map((day) => (
              <div
                key={day.key}
                className={cn(
                  'border-l border-border px-2 py-2 text-center',
                  day.key === today && 'bg-primary/5',
                )}
              >
                <p
                  className={cn(
                    'text-sm font-medium',
                    day.key === today ? 'text-primary' : 'text-foreground',
                  )}
                >
                  {day.name}
                </p>
                <p className="text-xs text-muted-foreground">{day.label}</p>
              </div>
            ))}
          </div>

          {/* --- the hours --- */}
          <div className="relative grid grid-cols-[4rem_repeat(7,1fr)]">
            <div>
              {hours.map((hour) => (
                <div
                  key={hour}
                  style={{ height: HOUR_HEIGHT }}
                  className="relative border-b border-border/60"
                >
                  <span className="absolute -top-2 right-2 text-xs text-muted-foreground">
                    {String(hour).padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>

            {days.map((day) => (
              <div key={day.key} className={cn('relative border-l border-border', day.key === today && 'bg-primary/5')}>
                {/* One drop target per half hour. Cheap, and it means the drop
                    lands where the cursor is rather than wherever a single
                    column-wide target decides. */}
                {hours.flatMap((hour) =>
                  [0, SNAP_MINUTES].map((offset) => (
                    <div
                      key={`${hour}:${offset}`}
                      style={{ height: HOUR_HEIGHT / 2 }}
                      onDragOver={(event) => {
                        if (!dragging) return
                        event.preventDefault()
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const postId = event.dataTransfer.getData('text/post-id')
                        if (postId) place(postId, day.key, hour * 60 + offset)
                      }}
                      className={cn(
                        'border-b',
                        offset === 0 ? 'border-transparent' : 'border-border/60',
                        dragging && 'hover:bg-primary/10',
                      )}
                    />
                  )),
                )}

                {/* --- the posts --- */}
                {(placed.get(day.key) ?? []).map((post) => {
                  const top = ((post.minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT
                  if (top < 0 || post.minutes > END_HOUR * 60 + 59) return null

                  const moved = Boolean(effective[post.id])
                  const movable = isMovable(post)

                  return (
                    <div
                      key={post.id}
                      draggable={movable}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/post-id', post.id)
                        event.dataTransfer.effectAllowed = 'move'
                        setDragging(post.id)
                      }}
                      onDragEnd={() => setDragging(null)}
                      style={{ top, height: HOUR_HEIGHT - 6 }}
                      className={cn(
                        'absolute inset-x-1 overflow-hidden rounded-[var(--radius)] px-2 py-1 text-left text-xs text-white shadow-sm',
                        TONE[post.status] ?? 'bg-muted-foreground',
                        movable ? 'cursor-grab active:cursor-grabbing' : 'opacity-80',
                        dragging === post.id && 'opacity-40',
                        moved && 'ring-2 ring-foreground/40',
                        post.id === highlight && !moved && 'ring-2 ring-foreground',
                      )}
                    >
                      <Link
                        href={`${ROUTES.posts}/${post.id}`}
                        draggable={false}
                        className="block"
                      >
                        <span className="block font-medium opacity-90">
                          {clockOf(post.minutes)}
                        </span>
                        <span className="line-clamp-2 leading-tight">
                          {post.caption.trim() || 'Untitled'}
                        </span>
                        {post.platforms.length > 0 ? (
                          <span className="mt-0.5 block truncate text-[10px] opacity-80">
                            {post.platforms.map((p) => PLATFORM_LABELS[p]).join(', ')}
                          </span>
                        ) : null}
                      </Link>
                    </div>
                  )
                })}
              </div>
            ))}

            {/* --- now --- */}
            {nowMinutes !== null &&
            nowMinutes >= START_HOUR * 60 &&
            nowMinutes <= END_HOUR * 60 + 59 ? (
              <div
                aria-hidden
                style={{ top: ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT }}
                className="pointer-events-none absolute inset-x-0 col-span-full flex items-center"
              >
                <span className="ml-[4rem] size-2 -translate-x-1 rounded-full bg-danger" />
                <span className="h-px flex-1 bg-danger/70" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- wall-clock arithmetic ---------------------------------------------------
//
// Strings throughout, as everywhere else that touches scheduling. A `Date`
// built in the browser carries the reader's offset into a decision that belongs
// to the workspace's zone.

function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function minutesOf(clock: string): number {
  const [h, m] = clock.split(':').map(Number)
  return h * 60 + m
}

function slotOf(post: WeekPost): string {
  return `${post.dayKey}T${clockOf(post.minutes)}`
}

/** Compared against the workspace's own today and clock, never the browser's. */
function isPastSlot(at: string, today: string, nowMinutes: number | null): boolean {
  const day = at.slice(0, 10)
  if (day < today) return true
  if (day > today || nowMinutes === null) return false
  return minutesOf(at.slice(11)) < nowMinutes
}
