import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { serverEnv } from '@/lib/env'
import type { Platform } from '@/lib/constants'
import { recordAudit } from '@/lib/audit/record'

/**
 * Provider-initiated data deletion (Section 11, Phase 0).
 *
 * Meta will not review an app for the permissions Module 4 needs without this.
 * When somebody removes the app from their Facebook account, Meta POSTs a
 * `signed_request` here and expects, in return, a URL a person can visit and a
 * code they can quote.
 *
 * WHAT IS DELETED, AND WHAT IS NOT. The request is about the data we obtained
 * from the platform about that person: the connections they made and the
 * tokens behind them. It is not a request to delete a workspace, its posts or
 * its invoices — those belong to the business that owns the workspace, and
 * somebody removing an app from their personal Facebook has not asked for
 * their employer's records to be destroyed. Deleting those would be an
 * overreach that looks like compliance.
 *
 * So: connections disconnected, tokens wiped, everything else left standing
 * and the workspace told. Posts scheduled to those accounts stop, because the
 * disconnect path already pauses them (Section 6.1).
 */

/** Short, unambiguous, and readable down a phone. No 0/O or 1/I. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function newConfirmationCode(): string {
  const bytes = randomBytes(12)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return out
}

/**
 * Verifies Meta's `signed_request` and returns the app-scoped user id.
 *
 * The signature is HMAC-SHA256 over the raw base64url payload with the app
 * secret — over the ENCODED string, not the decoded JSON, which is the detail
 * that makes a hand-rolled implementation silently reject everything.
 */
export function readSignedRequest(signed: string): { userId: string } | null {
  const [encodedSignature, encodedPayload] = signed.split('.', 2)
  if (!encodedSignature || !encodedPayload) return null

  const { META_APP_SECRET } = serverEnv()
  if (!META_APP_SECRET) return null

  const expected = createHmac('sha256', META_APP_SECRET).update(encodedPayload).digest()
  const actual = Buffer.from(encodedSignature, 'base64url')

  if (expected.length !== actual.length) return null
  if (!timingSafeEqual(expected, actual)) return null

  let payload: { algorithm?: string; user_id?: string }
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  // Meta signs with HMAC-SHA256 and says so. Anything else is either a forgery
  // or a version of the protocol this does not understand; both are refusals.
  if (payload.algorithm?.toUpperCase() !== 'HMAC-SHA256') return null
  if (!payload.user_id) return null

  return { userId: payload.user_id }
}

export type DeletionOutcome = {
  confirmationCode: string
  accountsRemoved: number
  nothingToRemove: boolean
}

/**
 * Carries out the deletion and records it.
 *
 * Idempotent by subject: a second request for the same person returns the
 * first request's code rather than starting again, so a provider that retries
 * does not produce a trail of codes none of which is the one the person was
 * given.
 */
export async function deleteForPlatformUser(
  platform: Platform,
  externalUserId: string,
): Promise<DeletionOutcome> {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('data_deletion_requests')
    .select('confirmation_code, accounts_removed, nothing_to_remove')
    .eq('platform', platform)
    .eq('external_user_id', externalUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      confirmation_code: string
      accounts_removed: number
      nothing_to_remove: boolean
    }>()

  if (existing) {
    return {
      confirmationCode: existing.confirmation_code,
      accountsRemoved: existing.accounts_removed,
      nothingToRemove: existing.nothing_to_remove,
    }
  }

  const { data: accounts } = await admin
    .from('social_accounts')
    .select('id, workspace_id')
    .eq('platform', platform)
    .eq('connected_external_user_id', externalUserId)
    .in('status', ['active', 'needs_reconnect'])
    .returns<{ id: string; workspace_id: string }[]>()

  const found = accounts ?? []

  if (found.length > 0) {
    // `disconnected`, not deleted. The row is the history of what published
    // where, and migration 0003's partial unique index only covers live
    // statuses — so the claim on the Page is released and somebody else may
    // connect it, which is the point.
    await admin
      .from('social_accounts')
      .update({
        status: 'disconnected',
        status_reason: 'Removed at the request of the account holder.',
        disconnected_at: new Date().toISOString(),
        // The tokens are the data the platform gave us. They go.
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
      })
      .in(
        'id',
        found.map((account) => account.id),
      )

    for (const account of found) {
      // `source: 'system'`, and no actor. Nobody in the workspace did this —
      // the platform asked on behalf of someone who may not even have an
      // account here. Left as the default 'web', the team's activity log
      // attributed it to a departed member, which is a different story.
      await recordAudit({
        workspaceId: account.workspace_id,
        actorId: null,
        action: 'connection.deleted_by_request',
        entityType: 'social_account',
        entityId: account.id,
        source: 'system',
        detail: { platform, via: 'provider_callback' },
      })
    }
  }

  const confirmationCode = newConfirmationCode()

  await admin.from('data_deletion_requests').insert({
    platform,
    external_user_id: externalUserId,
    confirmation_code: confirmationCode,
    accounts_removed: found.length,
    nothing_to_remove: found.length === 0,
    completed_at: new Date().toISOString(),
  })

  return {
    confirmationCode,
    accountsRemoved: found.length,
    nothingToRemove: found.length === 0,
  }
}
