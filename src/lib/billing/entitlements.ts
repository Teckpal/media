import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type {
  Database,
  SocialAccountRow,
  SubscriptionRow,
  WorkspaceRow,
} from '@/types/database'

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

export type PublishBlock =
  | { reason: 'no_subscription' }
  | { reason: 'subscription_lapsed'; until: string | null }
  | { reason: 'accounts_unpaid'; accountIds: string[]; names: string[] }
  | { reason: 'accounts_inactive'; accountIds: string[]; names: string[] }

export type Entitlement = { allowed: true } | { allowed: false; block: PublishBlock }

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

/** Statuses that still permit publishing. */
function subscriptionCovers(
  subscription: Pick<SubscriptionRow, 'status' | 'grace_until' | 'current_period_end'>,
  now: Date,
): boolean {
  if (subscription.status === 'active') {
    return new Date(subscription.current_period_end) > now
  }

  // Section 7.2: three days of grace past the due date before scheduled posts
  // pause and publishing locks. Data, drafts and connections are kept either
  // way — only the ability to send is withdrawn.
  if (subscription.status === 'past_due' || subscription.status === 'grace') {
    return Boolean(subscription.grace_until && new Date(subscription.grace_until) > now)
  }

  return false
}

/**
 * May this workspace publish to these accounts?
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

  // Section 13 Q4: Self (MOTiF) is internal and exempt. The flag is on the
  // workspace rather than inferred from its type, so a one-off exemption for
  // a partner or a beta account needs no code change.
  if (workspace.is_billing_exempt) return { allowed: true }

  const supabase = options.client ?? (await createClient())

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status, grace_until, current_period_end')
    .eq('workspace_id', workspace.id)
    .in('status', ['active', 'past_due', 'grace'])
    .maybeSingle()

  if (!subscription) {
    return { allowed: false, block: { reason: 'no_subscription' } }
  }

  if (!subscriptionCovers(subscription, now)) {
    return {
      allowed: false,
      block: { reason: 'subscription_lapsed', until: subscription.grace_until },
    }
  }

  if (accountIds.length === 0) return { allowed: true }

  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('id, display_name, external_username, status, paid_seat')
    .eq('workspace_id', workspace.id)
    .in('id', [...accountIds])

  const found = accounts ?? []

  // Section 6.1: a connection that needs reconnecting cannot publish, so a
  // post aimed at one must not be scheduled as though it could.
  const inactive = found.filter((a) => a.status !== 'active')
  if (inactive.length > 0) {
    return {
      allowed: false,
      block: {
        reason: 'accounts_inactive',
        accountIds: inactive.map((a) => a.id),
        names: inactive.map(nameOf),
      },
    }
  }

  // Section 7.2: "Connect an account beyond paid count — until paid, the
  // account can hold drafts only."
  const unpaid = found.filter((a) => !a.paid_seat)
  if (unpaid.length > 0) {
    return {
      allowed: false,
      block: {
        reason: 'accounts_unpaid',
        accountIds: unpaid.map((a) => a.id),
        names: unpaid.map(nameOf),
      },
    }
  }

  return { allowed: true }
}

function nameOf(
  account: Pick<SocialAccountRow, 'display_name' | 'external_username'>,
): string {
  return account.display_name ?? account.external_username ?? 'an account'
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
