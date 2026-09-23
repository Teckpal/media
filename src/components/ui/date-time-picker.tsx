'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Picking when a post goes out.
 *
 * This replaces `<input type="datetime-local">`, which was doing the job
 * badly for reasons that are not cosmetic:
 *
 *  - **It has no timezone**, and neither does it say so. The workspace
 *    schedules in Asia/Dhaka; the browser renders in whatever the laptop is
 *    set to, with no hint that the two differ. A travelling editor typing
 *    "9:00" had no way to see which nine o'clock they meant. Here the zone is
 *    named on the control and the calendar's "today" is the workspace's today,
 *    not the reader's.
 *  - **It cannot say what is unavailable.** The server rejects a time in the
 *    past, so the picker should never offer one — but `min` on a
 *    `datetime-local` is advisory, inconsistently enforced, and invisible.
 *    Past days are disabled here and read as disabled.
 *  - **Its format is the operating system's.** `mm/dd/yyyy --:-- --` on a US
 *    Chrome, something else elsewhere, and nothing a Bangladeshi team would
 *    write by hand.
 *
 * The value it produces is the same `YYYY-MM-DDTHH:mm` the old input produced,
 * posted through a hidden field, so `localInputToUtc` on the server is
 * unchanged and still the only thing that decides what the instant is.
 *
 * Everything is a wall-clock string here. No `Date` is constructed from the
 * user's choice in the browser, because a `Date` would carry the browser's
 * zone into a decision that belongs to the workspace's.
 */

export function DateTimePicker({
  name,
  value,
  onChange,
  timeZone,
  /** The workspace's today, `YYYY-MM-DD`, computed on the server in its zone. */
  today,
  disabled = false,
  id,
  describedBy,
  invalid = false,
}: {
  name: string
  /** `YYYY-MM-DDTHH:mm`, or empty for "no time chosen". */
  value: string
  onChange: (next: string) => void
  timeZone: string
  today: string
  disabled?: boolean
  id?: string
  describedBy?: string
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)

  /**
   * Whether the calendar opens upward.
   *
   * The composer's schedule field is the last thing on the page, so on a short
   * window — or any phone — a panel that always opened downward would put the
   * time controls and the Done button below the fold, reachable only by
   * scrolling a page the open popover is sitting on top of.
   */
  const [dropUp, setDropUp] = useState(false)

  const popoverRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const [date, time] = splitValue(value)

  // Which month the calendar is showing. Starts on the chosen date, or on the
  // workspace's current month when nothing is chosen yet.
  const [view, setView] = useState(() => monthOf(date || today))

  useEffect(() => {
    if (!open) return

    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cells = useMemo(() => monthCells(view), [view])

  function choose(nextDate: string) {
    // A day without a time is not a schedule. Nine in the morning is the
    // ordinary answer for a social post and is easy to change; leaving the
    // time blank would post at midnight, which nobody means.
    onChange(`${nextDate}T${time || '09:00'}`)
  }

  function chooseTime(nextTime: string) {
    onChange(`${date || today}T${nextTime}`)
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />

      <div className="flex gap-2">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!open) {
              // Opening lands on the chosen date's month rather than wherever
              // the calendar was left. Done here, in the handler, because the
              // same work in an effect is a second render for every open.
              if (date) setView(monthOf(date))

              // Measured against the real viewport rather than assumed. The
              // height is the panel's own, which is fixed by its contents —
              // six weeks of cells, the time row and the footer.
              const box = triggerRef.current?.getBoundingClientRect()
              setDropUp(Boolean(box && window.innerHeight - box.bottom < PANEL_HEIGHT))
            }

            setOpen((v) => !v)
          }}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-describedby={describedBy}
          className={cn(
            'flex flex-1 items-center gap-2.5 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-left text-sm transition-colors',
            disabled
              ? 'cursor-not-allowed opacity-60'
              : 'hover:border-muted-foreground/40',
            invalid && 'border-danger',
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {value ? (
            <span>{readable(date, time)}</span>
          ) : (
            <span className="text-muted-foreground">Pick a date and time</span>
          )}
        </button>

        {value && !disabled ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear the scheduled time"
            title="Clear"
            className="rounded-[var(--radius)] border border-border px-2.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {open && !disabled ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Choose a date and time"
          className={cn(
            'absolute z-40 w-[19rem] max-w-[calc(100vw-2rem)] rounded-[var(--radius)] border border-border bg-surface p-3 shadow-2xl',
            dropUp ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView(shiftMonth(view, -1))}
              aria-label="Previous month"
              className="rounded-[var(--radius)] p-1.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>

            <span className="text-sm font-medium">{monthLabel(view)}</span>

            <button
              type="button"
              onClick={() => setView(shiftMonth(view, 1))}
              aria-label="Next month"
              className="rounded-[var(--radius)] p-1.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((day) => (
              <span key={day} className="py-1 text-[11px] text-muted-foreground">
                {day}
              </span>
            ))}

            {cells.map((cell, i) =>
              cell === null ? (
                <span key={`blank-${i}`} />
              ) : (
                <button
                  key={cell}
                  type="button"
                  // Comparing `YYYY-MM-DD` strings, which sort the same way the
                  // dates do. No `Date` is built, so the browser's zone never
                  // gets a say in which day is past.
                  disabled={cell < today}
                  onClick={() => choose(cell)}
                  aria-current={cell === today ? 'date' : undefined}
                  className={cn(
                    'rounded-[var(--radius)] py-1.5 text-sm transition-colors',
                    cell < today && 'cursor-not-allowed text-muted-foreground/35',
                    cell >= today && cell !== date && 'hover:bg-surface-muted',
                    cell === today && cell !== date && 'font-medium text-primary',
                    cell === date && 'bg-primary font-medium text-primary-foreground',
                  )}
                >
                  {Number(cell.slice(8, 10))}
                </button>
              ),
            )}
          </div>

          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-sm">
              <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">Time</span>
              <input
                type="time"
                value={time || '09:00'}
                onChange={(e) => chooseTime(e.target.value || '09:00')}
                className="flex-1 rounded-[var(--radius)] border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </label>

            <div className="flex flex-wrap gap-1">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => chooseTime(preset.value)}
                  className={cn(
                    'rounded-[var(--radius)] border border-border px-2 py-1 text-xs transition-colors hover:bg-surface-muted',
                    time === preset.value && 'border-primary text-primary',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Times are in {timeZone}, the workspace&apos;s zone.
            </p>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-[var(--radius)] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// --- the string arithmetic ---------------------------------------------------
//
// All of it is on `YYYY-MM-DD` text rather than `Date`, deliberately. A `Date`
// built in the browser carries the browser's offset, and the one question this
// control must never get wrong is which day a given day is.

/** Roughly what the open panel occupies, in px. Used only to decide which way
 *  it opens, so being a few pixels out costs nothing. */
const PANEL_HEIGHT = 420

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const PRESETS = [
  { label: '9:00 am', value: '09:00' },
  { label: '12:00 pm', value: '12:00' },
  { label: '5:00 pm', value: '17:00' },
  { label: '8:00 pm', value: '20:00' },
]

function splitValue(value: string): [string, string] {
  const [date = '', time = ''] = value.split('T')
  return [date, time.slice(0, 5)]
}

/** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` -> `{ year, month }`. */
function monthOf(day: string): { year: number; month: number } {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) }
}

function shiftMonth(
  view: { year: number; month: number },
  by: number,
): { year: number; month: number } {
  const index = view.year * 12 + (view.month - 1) + by
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

function monthLabel(view: { year: number; month: number }): string {
  // UTC throughout: this names a month, and a month has no zone. Building the
  // date in local time would show December to somebody in Dhaka looking at
  // January.
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(view.year, view.month - 1, 1)))
}

/**
 * Six weeks of cells, Monday first, with `null` for the leading blanks.
 *
 * `Date.UTC` is used only to ask the calendar arithmetic questions — which
 * weekday a month starts on, how many days it has — never to represent the
 * user's choice.
 */
function monthCells(view: { year: number; month: number }): (string | null)[] {
  const first = new Date(Date.UTC(view.year, view.month - 1, 1))
  const daysInMonth = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate()

  // getUTCDay is Sunday-first; the grid is Monday-first.
  const lead = (first.getUTCDay() + 6) % 7

  const cells: (string | null)[] = Array.from({ length: lead }, () => null)

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(
      `${view.year}-${String(view.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    )
  }

  return cells
}

/** "1 Dec 2026 at 9:30 am". */
function readable(date: string, time: string): string {
  if (!date) return ''

  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))

  if (!time) return day

  const [hours, minutes] = time.split(':').map(Number)
  const suffix = hours < 12 ? 'am' : 'pm'
  const twelve = hours % 12 === 0 ? 12 : hours % 12

  return `${day} at ${twelve}:${String(minutes).padStart(2, '0')} ${suffix}`
}
