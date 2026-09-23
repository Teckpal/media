import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import {
  ACTIVITY_COOKIE,
  countsAsActivity,
  isAuthCookie,
  readActivity,
} from '@/lib/auth/idle'
import { REGION_COOKIE, REGION_COOKIE_MAX_AGE, readRegionHint } from '@/lib/region'
import { ROUTES } from '@/lib/routes'

/**
 * Runs on every request that is not a static asset.
 *
 * Three jobs:
 *   1. Refresh the Supabase auth cookie so server components see a live session.
 *   2. End a session that has been idle for thirty minutes.
 *   3. Stamp a region hint for the landing and paywall copy (Section 7A.2).
 *
 * The idle timeout is enforced HERE, on the server, and not in the browser. A
 * timer in a tab is a request, not a rule: close the tab, disable JavaScript or
 * simply keep the process suspended and it never fires. The cookie is the
 * clock, the server reads it, and the browser's copy of the timer exists only
 * so somebody is told promptly rather than on their next click.
 *
 * It still does not gate anything else. The router gate and the publish gate
 * live in server code next to the data (Module 2 and Module 7), because
 * middleware can be routed around and a check beside the query cannot.
 */
export default async function proxy(request: NextRequest) {
  const now = Date.now()
  const activity = readActivity(request.cookies.get(ACTIVITY_COOKIE)?.value, now)
  const hasAuthCookie = request.cookies.getAll().some((cookie) => isAuthCookie(cookie.name))

  if (activity === 'expired' && hasAuthCookie) {
    return endSession(request)
  }

  const { response } = await updateSession(request)

  /*
   * Only stamp for somebody who is actually signed in, and only when the
   * request is a real one. Stamping for a signed-out visitor would start the
   * clock on the marketing site and expire them the moment they logged in.
   */
  if (hasAuthCookie && countsAsActivity(request.headers)) {
    response.cookies.set(ACTIVITY_COOKIE, String(now), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      // No maxAge: it dies with the browser, like the auth cookies it guards.
    })
  }

  if (!request.cookies.has(REGION_COOKIE)) {
    const region = readRegionHint(undefined, request.headers.get('x-vercel-ip-country'))
    response.cookies.set(REGION_COOKIE, region, {
      maxAge: REGION_COOKIE_MAX_AGE,
      sameSite: 'lax',
      path: '/',
    })
  }

  return response
}

/**
 * Clears the session and sends them to sign in again.
 *
 * The cookies are deleted here rather than by calling `signOut`, because the
 * point is to stop this very request being served with a live session — and a
 * round trip to Supabase to revoke a refresh token we are about to throw away
 * would put a network call in the path of every expired request.
 *
 * A data request gets 401 instead of a redirect: answering a `fetch` with the
 * HTML of the login page produces a confusing parse error rather than a clear
 * one.
 */
function endSession(request: NextRequest) {
  const wantsHtml = request.headers.get('accept')?.includes('text/html')

  const response = wantsHtml
    ? NextResponse.redirect(new URL(`${ROUTES.login}?expired=1`, request.url))
    : new NextResponse(JSON.stringify({ error: 'session_expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })

  for (const cookie of request.cookies.getAll()) {
    if (isAuthCookie(cookie.name)) response.cookies.delete(cookie.name)
  }
  response.cookies.delete(ACTIVITY_COOKIE)

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static files and images.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
