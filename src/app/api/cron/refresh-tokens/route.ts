import { createAdminClient } from '@/lib/supabase/admin'
import { refreshExpiringTokens } from '@/lib/connections/refresh'
import { cronResult, isAuthorisedCron, unauthorised } from '@/lib/cron'

/**
 * Section 9: token refresh, every few hours.
 *
 * Also sweeps spent OAuth handoff rows — an expired `oauth_sessions` row still
 * holds a live platform token, so leaving them to accumulate would be a slowly
 * growing pile of credentials nobody is watching.
 */
export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return unauthorised()

  const summary = await refreshExpiringTokens()

  const { data: purged, error } = await createAdminClient().rpc(
    'purge_expired_oauth_sessions',
  )

  if (error) {
    console.error('[refresh] purging oauth sessions failed: %s', error.message)
    summary.degraded.push('purge_expired_oauth_sessions')
  }

  return cronResult({ ...summary, purgedOAuthSessions: purged ?? 0 })
}
