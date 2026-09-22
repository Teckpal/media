import 'server-only'

import { timingSafeEqual } from 'node:crypto'
import { serverEnv } from '@/lib/env'

/**
 * Guards `/api/cron/*`.
 *
 * These endpoints run with the service role and touch every workspace, so an
 * unauthenticated one would be an open door. The shared secret arrives as a
 * bearer token — which is what Vercel Cron sends when `CRON_SECRET` is set.
 *
 * Compared in constant time, so a wrong secret cannot be discovered a byte at
 * a time from how long the rejection takes.
 */
export function isAuthorisedCron(request: Request): boolean {
  const expected = serverEnv().CRON_SECRET
  const header = request.headers.get('authorization') ?? ''

  const presented = header.startsWith('Bearer ') ? header.slice(7) : header
  if (!presented) return false

  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

export function unauthorised(): Response {
  return new Response('Unauthorised', { status: 401 })
}

/** A tick that can report the queries it could not run. */
export type DegradableSummary = { degraded: string[] }

/**
 * Answers for a cron tick, and tells the truth when the tick could not work.
 *
 * Every one of these jobs reports counts, and a job whose database is
 * unreachable reports the same zeros as a job with nothing to do. That is the
 * worst possible failure for a scheduled task: Vercel Cron's monitoring watches
 * the response, so a swallowed error reads as a healthy minute, for ever, while
 * nothing publishes and nobody is told anything.
 *
 * So a tick that lost a query answers 503 with what it could not do. Anything
 * watching sees a failing job, which is what it is.
 */
export function cronResult<T extends DegradableSummary>(summary: T): Response {
  const ok = summary.degraded.length === 0
  return Response.json({ ok, ...summary }, { status: ok ? 200 : 503 })
}
