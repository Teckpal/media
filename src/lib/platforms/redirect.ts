import type { Platform } from '@/lib/constants'

/**
 * The callback URL, which must match what is registered with the provider
 * exactly — Meta compares it character for character at both the dialog and the
 * token exchange, and a mismatch fails with an unhelpful error.
 *
 * Derived from the request's own origin so localhost, a preview deployment and
 * production each build their own, with no third environment variable to keep
 * in step.
 */
export function redirectUriFor(platform: Platform, origin: string): string {
  return `${origin}/api/connect/${platform}/callback`
}
