import type { SocialAccountRow, SubscriptionRow } from '@/types/database'

/**
 * Gate 2 of the two in Section 4, as a decision rather than a query.
 *
 *   "Nothing is scheduled or published without an active subscription that
 *    covers that social account."
 *
 * Split out from `entitlements.ts` so it can be tested. That file imports
 * `server-only`, which is exactly right for something holding a database
 * client and exactly what stops `node --test` loading it — so the rules that
 * actually decide whether a post may go out had no tests at all, and two
 * defects lived in them:
 *
 *   1. A failed read produced an empty account list, which looked identical to
 *      "none of these accounts is a problem", and the gate returned allowed.
 *   2. An account id the workspace could not see appeared in neither the
 *      inactive nor the unpaid list, so it passed unexamined.
 *
 * Both are covered by tests beside this file now. The rule they encode is the
 * one this gate exists for: when it cannot tell, it refuses.
 */

export type PublishBlock =
  | { reason: 'no_subscription' }
  | { reason: 'subscription_lapsed'; until: string | null }
  | { reason: 'accounts_unpaid'; accountIds: string[]; names: string[] }
  | { reason: 'accounts_inactive'; accountIds: string[]; names: string[] }

export type Entitlement = { allowed: true } | { allowed: false; block: PublishBlock }

export type CoverageRow = Pick<
  SubscriptionRow,
  'status' | 'grace_until' | 'current_period_end'
>

export type SeatRow = Pick<
  SocialAccountRow,
  'id' | 'display_name' | 'external_username' | 'status' | 'paid_seat'
>

/** Statuses that still permit publishing. */
export function subscriptionCovers(subscription: CoverageRow, now: Date): boolean {
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

function nameOf(account: Pick<SeatRow, 'display_name' | 'external_username'>): string {
  return account.display_name ?? account.external_username ?? 'an account'
}

/**
 * The whole decision, given facts somebody else went and fetched.
 *
 * `readable: false` means a query failed. It is a separate argument rather than
 * an empty array precisely because the two must never again be confused.
 */
export function decideEntitlement(facts: {
  isBillingExempt: boolean
  coverage: CoverageRow | null
  /** The accounts a post is aimed at. Empty asks the weaker question. */
  requestedIds: readonly string[]
  accounts: SeatRow[]
  /** False when the accounts could not be read at all. */
  readable: boolean
  now: Date
}): Entitlement {
  // Section 13 Q4: Self (MOTiF) is internal and exempt.
  if (facts.isBillingExempt) return { allowed: true }

  if (!facts.coverage) return { allowed: false, block: { reason: 'no_subscription' } }

  if (!subscriptionCovers(facts.coverage, facts.now)) {
    return {
      allowed: false,
      block: { reason: 'subscription_lapsed', until: facts.coverage.grace_until },
    }
  }

  if (facts.requestedIds.length === 0) return { allowed: true }

  // A gate that cannot read refuses.
  if (!facts.readable) return { allowed: false, block: { reason: 'no_subscription' } }

  // Every account asked about must have been found. Being told about one of
  // two is not permission to publish to both.
  const seen = new Set(facts.accounts.map((account) => account.id))
  const missing = facts.requestedIds.filter((id) => !seen.has(id))
  if (missing.length > 0) {
    return {
      allowed: false,
      block: {
        reason: 'accounts_inactive',
        accountIds: missing,
        names: missing.map(() => 'an account that is no longer connected'),
      },
    }
  }

  // Section 6.1: a connection needing reconnection cannot publish, so a post
  // aimed at one must not be scheduled as though it could.
  const inactive = facts.accounts.filter((account) => account.status !== 'active')
  if (inactive.length > 0) {
    return {
      allowed: false,
      block: {
        reason: 'accounts_inactive',
        accountIds: inactive.map((account) => account.id),
        names: inactive.map(nameOf),
      },
    }
  }

  // Section 7.2: "Connect an account beyond paid count — until paid, the
  // account can hold drafts only."
  const unpaid = facts.accounts.filter((account) => !account.paid_seat)
  if (unpaid.length > 0) {
    return {
      allowed: false,
      block: {
        reason: 'accounts_unpaid',
        accountIds: unpaid.map((account) => account.id),
        names: unpaid.map(nameOf),
      },
    }
  }

  return { allowed: true }
}
