import { TZDate } from '@date-fns/tz'

/**
 * Section 6.2: "Timezone — store UTC. Show workspace timezone."
 *
 * Every scheduled time crosses this boundary twice: once when a person types a
 * wall-clock time in their workspace's zone, and once when it is shown back to
 * them. Both directions live here so neither is done by hand, and so the two
 * cannot drift apart.
 *
 * The `datetime-local` input has no zone of its own — "2026-10-01T09:00" means
 * whatever the reader decides it means. Interpreting it in the workspace zone,
 * rather than the browser's, is what makes "9am" mean the same thing to a
 * Dhaka team whose editor is travelling.
 */

/** Matches the value of an `<input type="datetime-local">`. */
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Reads a wall-clock string as a time in `timeZone`, and returns the instant.
 *
 * Returns null for anything unparseable, so a hand-edited form field is a
 * validation error rather than an `Invalid Date` written to the database.
 *
 * Across a daylight-saving jump the underlying library resolves the ambiguity
 * for us. Bangladesh has no DST, so the home market never hits it, but a
 * workspace in Europe or North America will.
 */
export function localInputToUtc(value: string, timeZone: string): Date | null {
  const match = LOCAL_INPUT.exec(value.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? 0)

  // The shape matched, but the numbers still have to be real. Date arithmetic
  // rolls over silently — month 13 becomes January of the next year, and
  // 31 February becomes 3 March — so a typo or a hand-edited field would be
  // accepted as a perfectly valid, entirely wrong, schedule.
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 59) return null

  const zoned = new TZDate(year, month - 1, day, hour, minute, second, 0, timeZone)

  const instant = new Date(zoned.getTime())
  if (Number.isNaN(instant.getTime())) return null

  // Catches the day-of-month overflows the range check cannot: 31 April, or
  // 29 February in a year that has no such date. If the constructed date is
  // not the date that was asked for, it was not a real date.
  if (zoned.getFullYear() !== year || zoned.getMonth() !== month - 1 || zoned.getDate() !== day) {
    return null
  }

  return instant
}

/**
 * The inverse: an instant, as the wall-clock string a `datetime-local` input
 * wants, in `timeZone`.
 */
export function utcToLocalInput(date: Date | string, timeZone: string): string {
  const zoned = new TZDate(new Date(date), timeZone)

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}` +
    `T${pad(zoned.getHours())}:${pad(zoned.getMinutes())}`
  )
}

/** Calendar day in `timeZone`, as `YYYY-MM-DD`. The calendar groups on this. */
export function dayKeyInZone(date: Date | string, timeZone: string): string {
  const zoned = new TZDate(new Date(date), timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-${pad(zoned.getDate())}`
}

/** Human time of day in `timeZone`, e.g. "9:00 am". */
export function formatTimeInZone(
  date: Date | string,
  timeZone: string,
  locale = 'en-GB',
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(date))
}

/** Human date and time in `timeZone`, e.g. "1 Oct 2026, 9:00 am". */
export function formatDateTimeInZone(
  date: Date | string,
  timeZone: string,
  locale = 'en-GB',
): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(date))
}

/**
 * The UTC span covering a calendar month in `timeZone`.
 *
 * A month in Dhaka is not a month in UTC — it starts six hours earlier. The
 * calendar query has to ask for the zone's month, or posts near midnight fall
 * into the wrong grid square.
 */
export function monthRangeUtc(
  year: number,
  month: number, // 1-12
  timeZone: string,
): { start: Date; end: Date } {
  const start = new TZDate(year, month - 1, 1, 0, 0, 0, 0, timeZone)
  const end = new TZDate(year, month, 1, 0, 0, 0, 0, timeZone)

  return { start: new Date(start.getTime()), end: new Date(end.getTime()) }
}

/** The zone's own idea of today, as `YYYY-MM-DD`. */
export function todayInZone(timeZone: string, now = new Date()): string {
  return dayKeyInZone(now, timeZone)
}

/** Is this instant in the past, allowing a minute of slack for clock skew? */
export function isPast(date: Date | string, now = new Date()): boolean {
  return new Date(date).getTime() < now.getTime() - 60_000
}
