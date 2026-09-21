import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { publicEnv, serverEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for work that has no user in scope: the publish worker, gateway
 * webhooks, cron jobs, admin tooling. Anything acting on behalf of a signed-in
 * user must use the request-scoped client in `./server` instead, so the
 * policies still apply.
 */
export function createAdminClient() {
  return createClient<Database>(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
