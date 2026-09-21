import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { REGION_COOKIE, REGION_COOKIE_MAX_AGE, readRegionHint } from '@/lib/region'

/**
 * Runs on every request that is not a static asset.
 *
 * Two jobs:
 *   1. Refresh the Supabase auth cookie so server components see a live session.
 *   2. Stamp a region hint for the landing and paywall copy (Section 7A.2).
 *
 * It deliberately does *not* gate anything. The router gate and the publish
 * gate are enforced in server code next to the data (Module 2 and Module 7),
 * because middleware can be skipped by a crafted request but a server-side
 * check next to the query cannot.
 */
export default async function proxy(request: NextRequest) {
  const { response } = await updateSession(request)

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

export const config = {
  matcher: [
    /*
     * Everything except static files and images.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
