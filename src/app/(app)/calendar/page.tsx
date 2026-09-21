import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import {
  dayKeyInZone,
  formatTimeInZone,
  monthRangeUtc,
  todayInZone,
} from '@/lib/time'
import { ROUTES } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { PostStatus } from '@/lib/constants'

export const metadata: Metadata = { title: 'Calendar' }

/**
 * Section 6.2: stored in UTC, shown in the workspace timezone.
 *
 * The grid is built from the *workspace's* month, not UTC's. October in Dhaka
 * begins at 18:00 UTC on 30 September, so a query over the UTC month would
 * file posts near midnight into the wrong square — the case
 * `monthRangeUtc` exists to handle.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const DOT: Partial<Record<PostStatus, string>> = {
  draft: 'bg-muted-foreground',
  pending_approval: 'bg-warning',
  scheduled: 'bg-primary',
  publishing: 'bg-primary',
  published: 'bg-success',
  paused: 'bg-warning',
  failed: 'bg-danger',
}

export default async function CalendarPage({ searchParams }: PageProps<'/calendar'>) {
  const { active } = await requireWorkspace()
  const timezone = active.workspace.timezone
  const params = await searchParams

  const today = todayInZone(timezone)
  const [todayYear, todayMonth] = today.split('-').map(Number)

  const year = clampInt(params.y, todayYear, 2000, 2100)
  const month = clampInt(params.m, todayMonth, 1, 12)

  const { start, end } = monthRangeUtc(year, month, timezone)

  const supabase = await createClient()
  const { data: posts } = await supabase
    .from('posts')
    .select('id, status, caption, scheduled_at')
    .eq('workspace_id', active.workspace.id)
    // Section 6.2: a removed post is hidden from the UI, and a cancelled one
    // is not going anywhere.
    .not('status', 'in', '("removed","cancelled")')
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', start.toISOString())
    .lt('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true })

  const byDay = new Map<string, typeof posts>()
  for (const post of posts ?? []) {
    const key = dayKeyInZone(post.scheduled_at!, timezone)
    const bucket = byDay.get(key) ?? []
    bucket.push(post)
    byDay.set(key, bucket)
  }

  const cells = buildGrid(year, month)
  const monthName = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))

  const previous = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{monthName}</h1>
          <p className="text-sm text-muted-foreground">Times in {timezone}.</p>
        </div>

        <div className="flex items-center gap-1">
          <Link
            href={`${ROUTES.calendar}?y=${previous.y}&m=${previous.m}`}
            className="rounded-[var(--radius)] p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span className="sr-only">Previous month</span>
          </Link>
          <Link
            href={ROUTES.calendar}
            className="rounded-[var(--radius)] px-3 py-2 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            Today
          </Link>
          <Link
            href={`${ROUTES.calendar}?y=${next.y}&m=${next.m}`}
            className="rounded-[var(--radius)] p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" aria-hidden />
            <span className="sr-only">Next month</span>
          </Link>
        </div>
      </div>

      <Card className="p-0">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell, index) => {
            const dayPosts = cell.key ? (byDay.get(cell.key) ?? []) : []
            const isToday = cell.key === today

            return (
              <div
                key={index}
                className={cn(
                  'min-h-24 border-b border-r border-border p-1.5 last:border-r-0',
                  !cell.key && 'bg-surface-muted/40',
                  index % 7 === 6 && 'border-r-0',
                )}
              >
                {cell.key ? (
                  <>
                    <span
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full text-xs',
                        isToday
                          ? 'bg-primary font-medium text-primary-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {cell.day}
                    </span>

                    <ul className="mt-1 space-y-1">
                      {dayPosts.slice(0, 3).map((post) => (
                        <li key={post.id}>
                          <Link
                            href={`${ROUTES.posts}/${post.id}`}
                            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-surface-muted"
                          >
                            <span
                              className={cn(
                                'size-1.5 shrink-0 rounded-full',
                                DOT[post.status] ?? 'bg-muted-foreground',
                              )}
                              aria-hidden
                            />
                            <span className="shrink-0 text-muted-foreground">
                              {formatTimeInZone(post.scheduled_at!, timezone)}
                            </span>
                            <span className="truncate">
                              {post.caption.trim() || 'Untitled'}
                            </span>
                          </Link>
                        </li>
                      ))}

                      {dayPosts.length > 3 ? (
                        <li className="px-1 text-xs text-muted-foreground">
                          +{dayPosts.length - 3} more
                        </li>
                      ) : null}
                    </ul>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

/**
 * A Monday-first grid, padded to whole weeks.
 *
 * The dates are built with `Date.UTC` purely as arithmetic on a calendar — no
 * instant is involved, so no timezone applies. Which day of the week the 1st
 * falls on is a property of the date itself.
 */
function buildGrid(year: number, month: number): { day: number; key: string | null }[] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  // getUTCDay is 0 for Sunday; shift so Monday is 0.
  const leading = (first.getUTCDay() + 6) % 7

  const cells: { day: number; key: string | null }[] = []

  for (let i = 0; i < leading; i += 1) cells.push({ day: 0, key: null })

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      day,
      key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    })
  }

  while (cells.length % 7 !== 0) cells.push({ day: 0, key: null })

  return cells
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}
