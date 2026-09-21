import type { Platform } from '@/lib/constants'

/**
 * The contract every platform integration implements.
 *
 * Six platforms land across three phases (Section 11). Keeping the OAuth
 * routes, the picker and the connections page written against this interface
 * means adding LinkedIn or TikTok is a new file, not a new code path.
 */

/** Section 6.1 gives each of these its own screen. */
export type ConnectFailure =
  | 'cancelled'
  | 'wrong_account_type'
  | 'missing_permissions'
  | 'already_connected'
  | 'provider_error'
  | 'invalid_state'

export class ConnectError extends Error {
  readonly failure: ConnectFailure
  /** Provider detail for the log. Never shown to the user verbatim. */
  readonly detail?: string

  constructor(failure: ConnectFailure, message: string, detail?: string) {
    super(message)
    this.name = 'ConnectError'
    this.failure = failure
    this.detail = detail
  }
}

/** A token as the platform issued it. */
export type IssuedToken = {
  accessToken: string
  refreshToken?: string
  /** Absent when the platform issues tokens that do not expire. */
  expiresAt?: Date
  scopes: string[]
}

/**
 * One connectable destination: a Facebook Page, an Instagram business account,
 * a LinkedIn organisation, a YouTube channel.
 *
 * Each carries its own token, because on most platforms the token that
 * publishes is not the token the user signed in with.
 */
export type DiscoveredAccount = {
  externalAccountId: string
  displayName: string
  username?: string
  avatarUrl?: string
  /** 'page' | 'business' | 'profile' | 'channel' */
  accountType: string
  /** An Instagram business account hangs off a Facebook Page; this is the Page. */
  parentExternalId?: string

  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  scopes: string[]
}

export type AuthUrlOptions = {
  redirectUri: string
  /** Opaque nonce; the adapter round-trips it and never interprets it. */
  state: string
}

export interface PlatformAdapter {
  readonly platform: Platform

  /** Scopes the integration needs. Used to explain a partial grant. */
  readonly requiredScopes: readonly string[]

  buildAuthUrl(options: AuthUrlOptions): string

  /** Swaps the callback code for a token, long-lived where the platform offers one. */
  exchangeCode(code: string, redirectUri: string): Promise<IssuedToken>

  /**
   * What this token can actually post to.
   *
   * Throws `ConnectError('wrong_account_type')` when the user has an account
   * but not of a kind that can be published to — a personal Instagram rather
   * than a business one, say.
   */
  listAccounts(token: IssuedToken): Promise<DiscoveredAccount[]>

  /**
   * Refreshes a stored token, or returns null when the platform has nothing to
   * refresh and the connection simply has to be redone.
   */
  refresh(token: IssuedToken): Promise<IssuedToken | null>
}

/** Did the grant include everything the integration needs? */
export function missingScopes(
  required: readonly string[],
  granted: readonly string[],
): string[] {
  const have = new Set(granted)
  return required.filter((scope) => !have.has(scope))
}
