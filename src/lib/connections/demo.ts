import 'server-only'

import { PLATFORM_LABELS, type Platform } from '@/lib/constants'

/**
 * Demo accounts: connections that exist so the product can be looked at.
 *
 * No platform credentials are configured yet, so the only account anybody can
 * actually connect is the seeded Facebook Page. That makes five of the six
 * platforms unreachable — you cannot see an Instagram preview, cannot check
 * whether a caption survives X's limit, cannot lay out a week across channels.
 * The work is built; it is just invisible.
 *
 * A demo account fills that gap and is honest about being a prop:
 *
 *  - It carries **no token**, so nothing can be published through it. That is
 *    not an oversight to be fixed later — it is the property that makes it
 *    safe. A fake account holding a real token would be a real account.
 *  - It is marked, in `account_type`, so every other part of the system can
 *    recognise one. The publish worker refuses it by name rather than
 *    discovering the missing token and reporting a lost connection, which
 *    would be a true sentence about the wrong thing.
 *  - It only exists under `OPEN_ACCESS`. When credentials arrive, the switch
 *    comes off and these stop being offered.
 *
 * Disconnecting one works exactly as it does for a real account, so nothing
 * here needs its own cleanup path.
 */

/** What `account_type` says, and what everything else checks. */
export const DEMO_ACCOUNT_TYPE = 'demo'

/**
 * The external id a demo account claims.
 *
 * Prefixed and deterministic, so the partial unique index in migration 0003 —
 * one live claim per (platform, external_account_id) — stops a workspace
 * collecting three demo Instagrams by clicking three times. It also means a
 * demo account can never collide with a real one: no platform issues ids that
 * look like this.
 */
export function demoExternalId(platform: Platform, workspaceId: string): string {
  return `demo:${platform}:${workspaceId}`
}

export function isDemoAccount(account: { account_type?: string | null }): boolean {
  return account.account_type === DEMO_ACCOUNT_TYPE
}

/** What a demo account calls itself. Recognisable at a glance in every list. */
export function demoDisplayName(platform: Platform): string {
  return `${PLATFORM_LABELS[platform]} (demo)`
}

export function demoUsername(platform: Platform): string {
  return `demo_${platform}`
}

/** The refusal, wherever publishing meets one of these. */
export const DEMO_PUBLISH_REFUSAL =
  'This is a demo account, so nothing can be published through it. Connect the real one to publish.'
