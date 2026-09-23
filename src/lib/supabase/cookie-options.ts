import type { CookieOptions } from '@supabase/ssr'

/**
 * Makes an auth cookie last only as long as the browser is open.
 *
 * Supabase sets its auth cookies with a `maxAge` measured in days, so a
 * session outlived the browser and sat on disk until it expired. Stripping
 * both `maxAge` and `expires` turns them into session cookies, which the
 * browser drops when it closes.
 *
 * WHAT THIS DOES NOT DO: end the session when a TAB closes. Cookies are shared
 * across every tab of a browser profile and no browser exposes a per-tab
 * lifetime, so "closed the tab" is not a thing a cookie can observe. Worse,
 * Chrome and Edge restore session cookies when "continue where you left off"
 * is on, which means even closing the browser is not a guarantee. The idle
 * timeout is what actually bounds an abandoned session; this narrows the
 * window, and the two are meant to be read together.
 */
export function sessionScoped(options: CookieOptions): CookieOptions {
  const scoped: CookieOptions = { ...options }
  delete scoped.maxAge
  delete scoped.expires
  return scoped
}
