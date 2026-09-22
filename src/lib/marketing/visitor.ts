import 'server-only'

import { unstable_rethrow } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'

/**
 * Is whoever is reading the landing page already signed in?
 *
 * The same question `getSessionUser` answers, with one difference: a failure to
 * answer it is not allowed to take the page down.
 *
 * Everywhere else in the app, failing to read the session is properly fatal —
 * every one of those pages is an authorisation decision and guessing would be
 * dangerous. Here it decides one thing: whether the button says "Dashboard" or
 * "Get started". If Supabase is unreachable, showing a stranger the sign-up
 * button is exactly right, and showing a signed-in visitor one costs them a
 * click. Neither is worth a 500 on the one page the public actually sees.
 *
 * `unstable_rethrow` is what makes the catch safe. Next signals control flow
 * with exceptions — `redirect()`, `notFound()`, and the one that caught this
 * out: reading cookies during a static render throws, and swallowing that
 * silently breaks the framework's own detection of a dynamic route. The first
 * build after this was written said so in the log, which is the only reason it
 * is not still wrong.
 */
export async function isSignedIn(): Promise<boolean> {
  try {
    return Boolean(await getSessionUser())
  } catch (cause) {
    unstable_rethrow(cause)
    console.error('[marketing] could not read the session: %s', String(cause))
    return false
  }
}
