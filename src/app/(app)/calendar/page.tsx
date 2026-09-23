import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MonthGrid, type GridPost } from '@/components/calendar/month-grid'
import { WeekGrid, type WeekPost } from '@/components/calendar/week-grid'
import { ViewSwitch, todayHref } from './view-switch'
import { SpotlightCursor } from '@/components/ui/spotlight-cursor'
import { Alert } from '@/components/ui/alert'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import {
  dayKeyInZone,
  dayRangeUtc,
  formatTimeInZone,
  minutesOfDayInZone,
  monthRangeUtc,
  todayInZone,
} from '@/lib/time'
import { ROUTES } from '@/lib/routes'
import { atLeast, type Platform, type PostStatus } from '@/lib/constants'

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

  const view: 'month' | 'week' = params.view === 'week' ? 'week' : 'month'

  const year = clampInt(params.y, todayYear, 2000, 2100)
  const month = clampInt(params.m, todayMonth, 1, 12)

  /**
   * The week in view, anchored on `?d=` and otherwise on today.
   *
   * Monday-first, matching the month grid, so moving between the two views
   * does not move the week under the reader.
   */
  const anchor = isDayKey(params.d) ? params.d : today
  const weekDays = view === 'week' ? buildWeek(anchor) : []

  // Whichever view is open decides what is fetched. A week is seven days out
  // of a month, and pulling the month to show a week would be four times the
  // rows for no reason.
  const range =
    view === 'week'
      ? dayRangeUtc(weekDays[0], 7, timezone)
      : monthRangeUtc(year, month, timezone)

  const { start, end } = range

  const supabase = await createClient()
  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('id, status, caption, scheduled_at, post_targets(platform)')
    .eq('workspace_id', active.workspace.id)
    // Section 6.2: a removed post is hidden from the UI, and a cancelled one
    // is not going anywhere.
    .not('status', 'in', '("removed","cancelled")')
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', start.toISOString())
    .lt('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true })
    .returns<
      {
        id: string
        status: PostStatus
        caption: string
        scheduled_at: string
        post_targets: { platform: Platform }[] | null
      }[]
    >()

  // Bound and surfaced. An unreadable calendar and an empty one look identical
  // otherwise, and a scheduling tool that silently shows no posts is the worst
  // version of itself.
  if (postsError) {
    throw new Error(`Could not read the calendar: ${postsError.message}`)
  }

  /**
   * The posts again, shaped for the grid.
   *
   * `clock` is the wall-clock time in the WORKSPACE's zone, and it is what a
   * move carries to the new day — the day was what the drag changed, the hour
   * was a decision somebody made. Working it out here rather than in the
   * browser is what keeps a reader in London from moving a 9am Dhaka post to
   * 3am (Section 6.2).
   */
  const weekPosts: WeekPost[] = (posts ?? []).map((post) => {
    const minutes = minutesOfDayInZone(post.scheduled_at, timezone)
    return {
      id: post.id,
      caption: post.caption,
      status: post.status,
      dayKey: dayKeyInZone(post.scheduled_at, timezone),
      clock: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      time: formatTimeInZone(post.scheduled_at, timezone),
      minutes,
      // Deduplicated: two Facebook Pages are one platform to a reader glancing
      // at a block an inch wide.
      platforms: [...new Set((post.post_targets ?? []).map((t) => t.platform))],
    }
  })

  const gridPosts: GridPost[] = weekPosts

  const cells = buildGrid(year, month)
  const monthName = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))

  // The post the composer just saved, so the grid can point at it. Validated
  // as a string and nothing more — it is only ever compared to ids already on
  // this page, so a crafted value matches nothing and does nothing.
  const saved = typeof params.saved === 'string' ? params.saved : null

  const previous = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }

  const back =
    view === 'week'
      ? `${ROUTES.calendar}?view=week&d=${addDays(anchor, -7)}`
      : `${ROUTES.calendar}?y=${previous.y}&m=${previous.m}`

  const forward =
    view === 'week'
      ? `${ROUTES.calendar}?view=week&d=${addDays(anchor, 7)}`
      : `${ROUTES.calendar}?y=${next.y}&m=${next.m}`

  // Switching view keeps the reader where they were: a week opens on the month
  // being looked at, and a month opens on the week's own month.
  const weekHref = `${ROUTES.calendar}?view=week&d=${
    view === 'week' ? anchor : firstOfMonthOrToday(year, month, today)
  }`
  const monthHref =
    view === 'week'
      ? `${ROUTES.calendar}?y=${anchor.slice(0, 4)}&m=${Number(anchor.slice(5, 7))}`
      : `${ROUTES.calendar}?y=${year}&m=${month}`

  const heading =
    view === 'week'
      ? `${formatDayLabel(weekDays[0])} – ${formatDayLabel(weekDays[6])}`
      : monthName

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
          <p className="text-sm text-muted-foreground">Times in {timezone}.</p>
        </div>

        <div className="flex items-center gap-2">
          <ViewSwitch view={view} monthHref={monthHref} weekHref={weekHref} />

          <div className="flex items-center gap-1">
            <Link
              href={back}
              className="rounded-[var(--radius)] p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            >
              <ChevronLeft className="size-4" aria-hidden />
              <span className="sr-only">
                {view === 'week' ? 'Previous week' : 'Previous month'}
              </span>
            </Link>
            <Link
              href={todayHref(view)}
              className="rounded-[var(--radius)] px-3 py-2 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            >
              Today
            </Link>
            <Link
              href={forward}
              className="rounded-[var(--radius)] p-2 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" aria-hidden />
              <span className="sr-only">{view === 'week' ? 'Next week' : 'Next month'}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Arriving from the composer. Saying so matters because the post was
          saved on a different screen — without it the calendar just happens to
          be showing a month, and the thing that changed is one square among
          thirty. */}
      {saved && gridPosts.some((post) => post.id === saved) ? (
        <Alert tone="success">Saved. It is on the calendar below.</Alert>
      ) : null}

      {view === 'week' ? (
        <WeekGrid
          posts={weekPosts}
          days={weekDays.map((key) => ({
            key,
            name: new Intl.DateTimeFormat('en-GB', {
              weekday: 'long',
              timeZone: 'UTC',
            }).format(new Date(`${key}T00:00:00Z`)),
            label: formatDayLabel(key),
          }))}
          today={today}
          // The workspace's clock, not the reader's. A "now" line drawn from
          // the browser would sit three hours out for anybody travelling.
          nowMinutes={weekDays.includes(today) ? minutesOfDayInZone(new Date(), timezone) : null}
          highlight={saved}
        />
      ) : (
        <MonthGrid
          posts={gridPosts}
          cells={cells}
          today={today}
          weekdays={WEEKDAYS}
          highlight={saved}
          timeZone={timezone}
          canWrite={atLeast(active.role, 'editor')}
        />
      )}

      {/* Decoration, and nothing depends on it: it draws nothing for a coarse
          pointer or for anyone who has asked for reduced motion. */}
      <SpotlightCursor config={{ radius: 260, brightness: 0.06, smoothing: 0.14 }} />
    </div>
  )
}

// --- days, as strings --------------------------------------------------------
//
// `Date.UTC` is used purely as calendar arithmetic here: which weekday a date
// falls on, and what comes seven days later. No instant is involved, so no
// timezone applies — which is exactly why these can be done on `YYYY-MM-DD`
// text without the workspace's zone entering into it.

function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** The Monday-first week containing `dayKey`, as seven day keys. */
function buildWeek(dayKey: string): string[] {
  const date = new Date(`${dayKey}T00:00:00Z`)
  const monday = addDays(dayKey, -((date.getUTCDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

function addDays(dayKey: string, by: number): string {
  const date = new Date(`${dayKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + by)
  return date.toISOString().slice(0, 10)
}

/** "15.09.2025", as on the reference layout. */
function formatDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-')
  return `${d}.${m}.${y}`
}

/** Opening the week view from a month: its first day, or today if that month is this one. */
function firstOfMonthOrToday(year: number, month: number, today: string): string {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  return today.startsWith(first.slice(0, 7)) ? today : first
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
