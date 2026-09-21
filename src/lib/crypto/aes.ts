import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * AES-256-GCM, with no dependency on the environment.
 *
 * Kept free of `server-only`, config and path aliases so it can be exercised
 * directly by the test runner — the wrapper in `./tokens` supplies the key.
 *
 * Stored format:  v1.<iv>.<ciphertext>.<tag>   (each part base64url)
 *
 * The version prefix is what makes rotation possible later: a v2 reader can
 * still decrypt v1 rows while they are re-encrypted in the background.
 */

export const VERSION = 'v1'
export const IV_BYTES = 12 // 96 bits, the size GCM is specified for
export const KEY_BYTES = 32 // AES-256

export function assertKey(raw: Buffer): Buffer {
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `Encryption key must be ${KEY_BYTES} bytes, got ${raw.length}. ` +
        'Generate one with: openssl rand -base64 32',
    )
  }
  return raw
}

/**
 * `aad` is additional authenticated data: not secret, but bound into the
 * ciphertext as a tamper check. A token encrypted for one account cannot be
 * pasted into another account's row and still decrypt, so a write that swaps
 * rows around is caught rather than silently publishing to the wrong page.
 */
export function encryptWithKey(key: Buffer, plaintext: string, aad?: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', assertKey(key), iv)

  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'))

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [
    VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.')
}

/** Throws if the payload was tampered with, or if `aad` does not match. */
export function decryptWithKey(key: Buffer, payload: string, aad?: string): string {
  const parts = payload.split('.')
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted payload')
  }

  const [version, ivPart, ciphertextPart, tagPart] = parts
  if (version !== VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`)
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    assertKey(key),
    Buffer.from(ivPart, 'base64url'),
  )

  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** Constant-time compare, for OAuth state nonces and OTP hashes. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * The AAD for a connection's tokens.
 *
 * Built from the platform identity rather than the row's uuid, so the value is
 * known before the row exists and stays stable if the row is recreated during
 * a transfer.
 */
export function accountTokenContext(
  workspaceId: string,
  platform: string,
  externalAccountId: string,
): string {
  return `social_account:${workspaceId}:${platform}:${externalAccountId}`
}
