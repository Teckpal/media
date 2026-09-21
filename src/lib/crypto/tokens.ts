import 'server-only'

import { serverEnv } from '@/lib/env'
import {
  assertKey,
  decryptWithKey,
  encryptWithKey,
  KEY_BYTES,
} from '@/lib/crypto/aes'

/**
 * Encryption for OAuth tokens at rest, with the key read from the environment.
 *
 * Section 10 calls for encrypted tokens and Section 9 suggests Supabase Vault.
 * This does it in the application instead, for two reasons: the key can be
 * rotated and later moved to a KMS without a database migration, and a database
 * dump — including one taken by someone holding the service role key — yields
 * nothing usable on its own.
 *
 * The algorithm lives in `./aes`, free of config, so it can be tested directly.
 */

let cachedKey: Buffer | null = null

function key(): Buffer {
  if (cachedKey) return cachedKey

  const raw = Buffer.from(serverEnv().TOKEN_ENCRYPTION_KEY, 'base64')
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${raw.length}. ` +
        'Generate one with: openssl rand -base64 32',
    )
  }

  cachedKey = assertKey(raw)
  return cachedKey
}

export function encryptToken(plaintext: string, context?: string): string {
  return encryptWithKey(key(), plaintext, context)
}

export function decryptToken(payload: string, context?: string): string {
  return decryptWithKey(key(), payload, context)
}

/**
 * Null-safe decrypt, for rows where the column may legitimately be empty.
 *
 * Returns null rather than throwing when the payload will not open, so a single
 * corrupted or wrong-context row cannot take down a batch of connections in the
 * publish worker. Callers treat null as "this connection needs reconnecting".
 */
export function decryptTokenOrNull(
  payload: string | null | undefined,
  context?: string,
): string | null {
  if (!payload) return null
  try {
    return decryptToken(payload, context)
  } catch {
    return null
  }
}

export { accountTokenContext, safeEqual } from '@/lib/crypto/aes'
