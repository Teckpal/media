import 'server-only'

import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'
import { encryptToken, decryptTokenOrNull, safeEqual } from '@/lib/crypto/tokens'
import type { Platform } from '@/lib/constants'

/**
 * CSRF protection for the OAuth round trip.
 *
 * The `state` parameter that travels to the provider and back is a bare nonce.
 * Everything it means — which workspace, which platform, where to return —
 * stays on this side, encrypted in an httpOnly cookie. So a forged callback
 * carries a nonce that matches no cookie, and a stolen cookie carries a nonce
 * the attacker cannot predict.
 *
 * The alternative, signing a fat state parameter, leaks the workspace id into
 * the provider's logs and into the browser's history for no benefit.
 */

const COOKIE = 'motif_oauth'
/** Long enough to tick permission boxes, short enough that a stale one is dead. */
const TTL_MS = 10 * 60 * 1000

type OAuthState = {
  nonce: string
  platform: Platform
  workspaceId: string
  userId: string
  /** Where to send the user afterwards — onboarding, or the connections page. */
  returnTo: string
  issuedAt: number
}

/** The AAD, so a state cookie cannot be replayed as any other ciphertext. */
const CONTEXT = 'oauth_state:v1'

export async function beginOAuth(params: {
  platform: Platform
  workspaceId: string
  userId: string
  returnTo: string
}): Promise<string> {
  const nonce = randomBytes(24).toString('base64url')

  const state: OAuthState = {
    nonce,
    platform: params.platform,
    workspaceId: params.workspaceId,
    userId: params.userId,
    returnTo: params.returnTo,
    issuedAt: Date.now(),
  }

  const jar = await cookies()
  jar.set(COOKIE, encryptToken(JSON.stringify(state), CONTEXT), {
    httpOnly: true,
    sameSite: 'lax', // 'strict' would drop the cookie on the provider's redirect
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_MS / 1000,
  })

  return nonce
}

/**
 * Validates the callback and consumes the cookie, whether or not it matched —
 * a state is single-use, so a replayed callback finds nothing.
 */
export async function consumeOAuth(
  nonceFromProvider: string | null,
  platform: Platform,
): Promise<OAuthState | null> {
  const jar = await cookies()
  const raw = jar.get(COOKIE)?.value
  jar.delete(COOKIE)

  if (!raw || !nonceFromProvider) return null

  const decrypted = decryptTokenOrNull(raw, CONTEXT)
  if (!decrypted) return null

  let state: OAuthState
  try {
    state = JSON.parse(decrypted) as OAuthState
  } catch {
    return null
  }

  if (!safeEqual(state.nonce, nonceFromProvider)) return null
  if (state.platform !== platform) return null
  if (Date.now() - state.issuedAt > TTL_MS) return null

  return state
}
