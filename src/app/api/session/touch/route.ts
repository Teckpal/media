import { NextResponse } from 'next/server'

/**
 * "Somebody is still here."
 *
 * The proxy refreshes the activity cookie on any real request, and this exists
 * solely so that a person who is working without navigating — writing a long
 * caption, say — still counts as present. It carries no body and decides
 * nothing: the proxy has already stamped the cookie by the time this handler
 * runs, and if the session had expired the proxy would have answered 401
 * instead of letting the request through.
 */
export function POST() {
  return new NextResponse(null, { status: 204 })
}
