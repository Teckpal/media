import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/routes'

/**
 * PKCE code exchange, for flows that hand back a `code` rather than a
 * `token_hash` — magic links and invite links.
 *
 * `next` is checked to be a path on this site before it is used, so the link
 * cannot be dressed up to bounce a freshly signed-in user somewhere else.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  if (!code) {
    return NextResponse.redirect(`${origin}${ROUTES.login}?error=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}${ROUTES.login}?error=exchange_failed`)
  }

  const destination = isSafeInternalPath(next) ? next : ROUTES.dashboard
  return NextResponse.redirect(`${origin}${destination}`)
}

/** A single leading slash, so "//evil.example" and "https://…" are rejected. */
function isSafeInternalPath(value: string | null): value is string {
  return Boolean(value) && /^\/(?!\/)/.test(value as string)
}
