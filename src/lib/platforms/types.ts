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

  /**
   * The platform's id for the PERSON who connected this, where it issues one.
   *
   * Not the account's own id: one person connects many Pages, and a
   * provider-initiated deletion request names the person. Meta's is app-scoped
   * — stable here, meaningless anywhere else. Absent on platforms that issue
   * nothing comparable.
   */
  connectedExternalUserId?: string

  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  scopes: string[]
}

export type AuthUrlOptions = {
  redirectUri: string
  /** Opaque nonce; the adapter round-trips it and never interprets it. */
  state: string
  /**
   * The S256 hash of a verifier the route has already stored in the state
   * cookie. Present only for adapters that set `usesPkce`; the adapter passes
   * it through and never generates it, so there is one PKCE implementation
   * rather than one per platform.
   */
  codeChallenge?: string
}

export interface PlatformAdapter {
  readonly platform: Platform

  /** Scopes the integration needs. Used to explain a partial grant. */
  readonly requiredScopes: readonly string[]

  /**
   * The platform requires PKCE (X and TikTok do; Meta and LinkedIn do not).
   * When true the route mints a verifier, keeps it in the encrypted state
   * cookie, and hands the adapter the challenge on the way out and the
   * verifier on the way back.
   */
  readonly usesPkce?: boolean

  buildAuthUrl(options: AuthUrlOptions): string

  /** Swaps the callback code for a token, long-lived where the platform offers one. */
  exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<IssuedToken>

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

  /** Sends the post. Throws `PublishError`; see its flags for what happens next. */
  publish(request: PublishRequest): Promise<PublishResult>

  /**
   * Did an earlier attempt land after all?
   *
   * The Graph API has no idempotency key, so after an ambiguous failure the
   * only honest way to avoid publishing twice is to go and look. Returns null
   * when nothing matching is found — and callers treat "cannot tell" as a
   * refusal to retry rather than as a licence to send again.
   */
  findRecentlyPublished(
    request: PublishRequest,
    since: Date,
  ): Promise<PublishResult | null>
}

/** Did the grant include everything the integration needs? */
export function missingScopes(
  required: readonly string[],
  granted: readonly string[],
): string[] {
  const have = new Set(granted)
  return required.filter((scope) => !have.has(scope))
}

// --- publishing --------------------------------------------------------------

/**
 * A piece of media as the platform will see it.
 *
 * `url` is a signed, time-limited link into our private bucket. Meta fetches
 * the bytes itself rather than accepting an upload, so the link has to outlive
 * the request — see `src/lib/publish/media.ts` for how long and why.
 */
export type PublishMedia = {
  id: string
  mimeType: string
  url: string
  altText?: string | null
}

export type PublishRequest = {
  externalAccountId: string
  /** Decrypted at the last moment, never logged. */
  accessToken: string
  caption: string
  media: PublishMedia[]
  /**
   * Our key for this (post, account), minted once (Section 6.2).
   *
   * Meta has nowhere to put it — the Graph API has no idempotency header — so
   * it is not sent. It identifies the attempt in our own logs, and the real
   * protection against a double publish is the single-flight claim plus
   * `findRecentlyPublished` below.
   */
  idempotencyKey: string
  /** From an earlier attempt, when one got as far as building a container. */
  containerId?: string | null
}

export type PublishResult = {
  externalPostId: string
  permalink?: string | null
  /** Worth storing: a retry publishes this container rather than a second one. */
  containerId?: string | null
}

/**
 * A publish that did not work.
 *
 * Two flags decide what the worker does next, and they are not the same
 * question:
 *
 * - `retryable` — would doing this again plausibly work? A 500 or a rate limit,
 *   yes. A revoked token or a caption the platform rejected, no; retrying
 *   those burns attempts and delays telling the user something they have to
 *   act on.
 * - `ambiguous` — might it have worked anyway? A timeout after the request was
 *   accepted looks identical to one before it. A retry here risks publishing
 *   twice, so the worker reconciles before it tries again.
 */
export class PublishError extends Error {
  readonly retryable: boolean
  readonly ambiguous: boolean
  /**
   * The platform is still processing something we already handed it — an
   * Instagram video container, typically. Not a failure, so it does not spend
   * one of the attempts; the worker simply comes back later.
   */
  readonly stillProcessing: boolean
  /** A container the next attempt should resume rather than rebuild. */
  readonly containerId?: string | null
  /** Provider detail for the log. Never shown to the user verbatim. */
  readonly detail?: string
  /** What the user is told. */
  readonly userMessage: string

  constructor(
    userMessage: string,
    options: {
      retryable: boolean
      ambiguous?: boolean
      stillProcessing?: boolean
      containerId?: string | null
      detail?: string
    },
  ) {
    super(userMessage)
    this.name = 'PublishError'
    this.userMessage = userMessage
    this.retryable = options.retryable
    this.ambiguous = options.ambiguous ?? false
    this.stillProcessing = options.stillProcessing ?? false
    this.containerId = options.containerId ?? null
    this.detail = options.detail
  }
}
