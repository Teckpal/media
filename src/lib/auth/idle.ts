/**
 * How long a session survives without the person using it.
 *
 * Thirty minutes, measured from the last thing they actually did. The clock
 * lives in a cookie rather than in memory so it survives a server restart, a
 * second tab, and a deploy — and because the server has to be the one that
 * decides, or a timeout is merely a suggestion the browser may ignore.
 */
export const IDLE_LIMIT_MS = 30 * 60 * 1000

/** Holds the last-activity timestamp, in milliseconds since the epoch. */
export const ACTIVITY_COOKIE = 'motif_seen'

/**
 * How often the browser tells the server somebody is still there.
 *
 * Only when they have actually done something since the last ping. Without
 * this, a person writing a long post for forty minutes without navigating
 * would be signed out mid-sentence and lose it — the timeout is meant to catch
 * an abandoned desk, not a thoughtful one.
 */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export type IdleVerdict = 'fresh' | 'expired' | 'unknown'

/**
 * Is this session still within its idle window?
 *
 * `unknown` means there is no usable stamp — a first request, or a tampered
 * value. That is deliberately NOT treated as expired: the caller stamps it and
 * carries on, because signing somebody out on their very first request would
 * make the application unusable rather than secure.
 */
export function readActivity(raw: string | undefined, now: number): IdleVerdict {
  if (!raw) return 'unknown'

  const seen = Number(raw)

  // Not a number, negative, or in the future — all signs of a value nobody
  // should trust. Treated as missing rather than as valid.
  if (!Number.isFinite(seen) || seen <= 0 || seen > now + 60_000) return 'unknown'

  return now - seen > IDLE_LIMIT_MS ? 'expired' : 'fresh'
}

/**
 * Does this request count as the person doing something?
 *
 * Prefetches arrive as ordinary requests. Left counted, a cursor drifting
 * across a nav bar would keep a session alive on an unattended screen — the
 * exact thing the timeout exists to prevent.
 *
 * MEASURED, NOT ASSUMED: `purpose: prefetch` reaches this and is filtered.
 * `next-router-prefetch`, which Next's own router sends, did NOT reach the
 * proxy on 16.3.5 — so a router prefetch can still refresh the clock. Both
 * checks are kept because they cost nothing and the second may start working
 * again; the limitation is real and is written down rather than assumed away.
 */
export function countsAsActivity(headers: {
  get(name: string): string | null
}): boolean {
  if (headers.get('next-router-prefetch')) return false
  if (headers.get('purpose') === 'prefetch') return false
  if (headers.get('x-purpose') === 'preview') return false
  return true
}

/** Supabase's auth cookies, whatever the project ref and however chunked. */
export function isAuthCookie(name: string): boolean {
  return name.startsWith('sb-') && name.includes('auth-token')
}
