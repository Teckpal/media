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
