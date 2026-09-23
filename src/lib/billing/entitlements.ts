import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { Database, WorkspaceRow } from '@/types/database'
import {
  decideEntitlement,
  type CoverageRow,
  type Entitlement,
  type PublishBlock,
  type SeatRow,
} from '@/lib/billing/entitlement-rules'
import { noteOpenAccess, openAccess } from '@/lib/billing/open-access'

/**
 * Gate 2 of the two in Section 4.
 *
 *   "Nothing is scheduled or published without an active subscription that
 *    covers that social account."
 *
 * Section 7.1 is blunt about it: scheduling and publishing are fully paid, with
 * no free tier. Section 5, rule 6 says what unpaid mode *can* do — edit setup,
 * manage connections, write drafts, look at the calendar — and this is the line
 * between those two lists.
 *
 * Every caller checks it server-side. The composer hides the Schedule button
 * as a courtesy; this is what actually refuses.
 */

export type { Entitlement, PublishBlock } from '@/lib/billing/entitlement-rules'

/**
 * Which client asks the question.
 *
 * A signed-in user gets the request-scoped client, so RLS narrows the answer to
 * their own workspace. The publish worker has no user in scope and passes the
 * service-role client instead — it is asking about a workspace nobody is
 * currently signed in to. Same rules either way; only the reader differs.
 */
export type EntitlementClient = SupabaseClient<Database>

export type EntitlementOptions = {
  now?: Date
  client?: EntitlementClient
}

/**
 * May this workspace publish to these accounts?
 *
 * This half only fetches. Every rule lives in `decideEntitlement`, where it can
 * be tested — this file imports `server-only`, which is why the rules had no
 * tests and how two fail-open defects survived in them.
 *
 * `accountIds` is the set a post is actually going to. An empty set asks the
 * weaker question — may this workspace schedule anything at all — which is what
 * the composer needs before any target has been chosen.
 */
export async function canPublish(
  workspace: Pick<WorkspaceRow, 'id' | 'is_billing_exempt'>,
  accountIds: readonly string[],
  options: EntitlementOptions = {},
): Promise<Entitlement> {
  const now = options.now ?? new Date()

  // The free-for-now switch enters here and nowhere else, through the same
  // door Section 13 Q4 already opened for MOTiF's own workspace. One path, one
  // set of tests, and removing the flag restores the gate exactly.
  noteOpenAccess()

  if (workspace.is_billing_exempt || openAccess()) {
    return decideEntitlement({
      isBillingExempt: true,
      coverage: null,
      requestedIds: accountIds,
      accounts: [],
      readable: true,
      now,
    })
  }

  const supabase = options.client ?? (await createClient())

  // Asked through `publishing_coverage` (migration 0013) rather than by reading
  // `subscriptions` directly. Section 6.3 makes billing the owner's alone and
  // migration 0008 enforces that with an owner-only policy — which meant an
  // editor opening the composer saw no subscription and was told to buy a plan
  // their workspace already had. The function answers the narrow question any
  // member may ask, and exposes no amounts.
  const { data: coverage } = await supabase.rpc('publishing_coverage', {
    ws: workspace.id,
  })

  const subscription = (coverage?.[0] as CoverageRow | undefined) ?? null

  // Nothing to look up when no target has been chosen, or when there is no
  // subscription to cover one.
  if (!subscription || accountIds.length === 0) {
    return decideEntitlement({
      isBillingExempt: false,
      coverage: subscription,
      requestedIds: accountIds,
      accounts: [],
      readable: true,
      now,
    })
  }

  const { data: accounts, error } = await supabase
    .from('social_accounts')
    .select('id, display_name, external_username, status, paid_seat')
    .eq('workspace_id', workspace.id)
    .in('id', [...accountIds])

  return decideEntitlement({
    isBillingExempt: false,
    coverage: subscription,
    requestedIds: accountIds,
    accounts: (accounts ?? []) as SeatRow[],
    // The distinction the old code lost: a failed read is not an empty result.
    readable: !error,
    now,
  })
}

/** One sentence a person can act on. */
export function explainBlock(block: PublishBlock): string {
  switch (block.reason) {
    case 'no_subscription':
      return 'Scheduling and publishing need an active plan. Your drafts are safe in the meantime.'
    case 'subscription_lapsed':
      return 'Your plan is past due, so publishing is locked. Settle the invoice to resume.'
    case 'accounts_unpaid':
      return `${listNames(block.names)} ${block.names.length === 1 ? 'is' : 'are'} not covered by your plan yet, so ${block.names.length === 1 ? 'it' : 'they'} can only hold drafts.`
    case 'accounts_inactive':
      return `${listNames(block.names)} ${block.names.length === 1 ? 'needs' : 'need'} reconnecting before anything can be scheduled.`
  }
}

function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
