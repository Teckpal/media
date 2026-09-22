import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MonthGrid, type GridPost } from '@/components/calendar/month-grid'
import { SpotlightCursor } from '@/components/ui/spotlight-cursor'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import {
  dayKeyInZone,
  formatTimeInZone,
  minutesOfDayInZone,
  monthRangeUtc,
  todayInZone,
} from '@/lib/time'
import { ROUTES } from '@/lib/routes'

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

  /**
   * The posts again, shaped for the grid.
   *
   * `clock` is the wall-clock time in the WORKSPACE's zone, and it is what a
   * move carries to the new day — the day was what the drag changed, the hour
   * was a decision somebody made. Working it out here rather than in the
   * browser is what keeps a reader in London from moving a 9am Dhaka post to
   * 3am (Section 6.2).
   */
  const gridPosts: GridPost[] = (posts ?? []).map((post) => {
    const minutes = minutesOfDayInZone(post.scheduled_at!, timezone)
    return {
      id: post.id,
      caption: post.caption,
      status: post.status,
      dayKey: dayKeyInZone(post.scheduled_at!, timezone),
      clock: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      time: formatTimeInZone(post.scheduled_at!, timezone),
    }
  })

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

      <MonthGrid
        posts={gridPosts}
        cells={cells}
        today={today}
        weekdays={WEEKDAYS}
      />

      {/* Decoration, and nothing depends on it: it draws nothing for a coarse
          pointer or for anyone who has asked for reduced motion. */}
      <SpotlightCursor config={{ radius: 260, brightness: 0.06, smoothing: 0.14 }} />
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
