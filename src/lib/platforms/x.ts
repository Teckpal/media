import 'server-only'

import { serverEnv } from '@/lib/env'
import { CHALLENGE_METHOD } from '@/lib/platforms/pkce'
import {
  ConnectError,
  PublishError,
  missingScopes,
  type AuthUrlOptions,
  type DiscoveredAccount,
  type IssuedToken,
  type PlatformAdapter,
  type PublishRequest,
  type PublishResult,
} from '@/lib/platforms/types'

/**
 * X (Twitter), API v2.
 *
 * Three things make this adapter shaped differently from Meta's.
 *
 * **PKCE is mandatory**, and the token endpoint wants HTTP Basic auth built
 * from the client id and secret as well. Getting one of the two wrong produces
 * the same opaque `invalid_grant`, so both are done in one place here.
 *
 * **Tokens are short.** X issues a two-hour access token and a refresh token,
 * and the refresh token ROTATES — every refresh returns a new one, and the old
 * one dies. `refresh()` therefore returns the new pair and the caller must
 * store both; dropping the new refresh token strands the connection until the
 * user reconnects.
 *
 * **There is nothing to list.** A token belongs to exactly one account, so
 * `listAccounts` returns one entry rather than a choice. The picker handles a
 * single result fine; the alternative would be inventing a hierarchy X does
 * not have.
 *
 * UNTESTED. Written from the documented API, like Meta's was, and never run
 * against the real thing — there are no credentials. The error-code mapping in
 * particular is the kind of thing that is only right after production traffic.
 */

const AUTHORIZE = 'https://x.com/i/oauth2/authorize'
const TOKEN = 'https://api.x.com/2/oauth2/token'
const API = 'https://api.x.com/2'

const SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'media.write',
  // Without this X issues no refresh token at all, and the connection dies
  // two hours later with nothing to renew it.
  'offline.access',
] as const

function credentials(): { clientId: string; clientSecret: string } {
  const env = serverEnv()
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) {
    throw new ConnectError(
      'provider_error',
      'X is not configured yet.',
      'X_CLIENT_ID or X_CLIENT_SECRET is unset',
    )
  }
  return { clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET }
}

/** X wants the client pair as Basic auth on the token endpoint, not in the body. */
function basicAuth(): string {
  const { clientId, clientSecret } = credentials()
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function requestToken(body: URLSearchParams): Promise<IssuedToken> {
  let response: Response
  try {
    response = await fetch(TOKEN, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      cache: 'no-store',
    })
  } catch (cause) {
    throw new ConnectError('provider_error', 'We could not reach X.', String(cause))
  }

  const payload = (await response.json().catch(() => ({}))) as TokenResponse

  if (!response.ok || !payload.access_token) {
    throw new ConnectError(
      'provider_error',
      'X would not complete the connection.',
      payload.error_description || payload.error || `HTTP ${response.status}`,
    )
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000)
      : undefined,
    scopes: payload.scope ? payload.scope.split(' ') : [...SCOPES],
  }
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    })
  } catch (cause) {
    // Never reached the network, so nothing can have been posted.
    throw new PublishError('We could not reach X.', {
      retryable: true,
      ambiguous: false,
      detail: String(cause),
    })
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    title?: string
    detail?: string
  }

  if (!response.ok) {
    throw classify(response.status, body)
  }

  return body as T
}

/**
 * Which failures are worth trying again.
 *
 * 429 and 5xx yes; a rejected post or a dead token no, because retrying those
 * burns attempts and delays telling somebody they have to act. A 5xx is also
 * ambiguous — X may have accepted the tweet before falling over — so the
 * worker reconciles rather than sending a second one.
 */
function classify(status: number, body: { title?: string; detail?: string }): PublishError {
  const detail = body.detail || body.title || `HTTP ${status}`

  if (status === 429) {
    return new PublishError('X is rate limiting us. We will try again shortly.', {
      retryable: true,
      ambiguous: false,
      detail,
    })
  }

  if (status === 401 || status === 403) {
    return new PublishError(
      'X refused the connection. Reconnect the account to continue posting.',
      { retryable: false, ambiguous: false, detail },
    )
  }

  if (status >= 500) {
    return new PublishError('X had a problem on their side.', {
      retryable: true,
      ambiguous: true,
      detail,
    })
  }

  return new PublishError('X rejected this post.', {
    retryable: false,
    ambiguous: false,
    detail,
  })
}

export const xAdapter: PlatformAdapter = {
  platform: 'twitter',
  requiredScopes: SCOPES,
  usesPkce: true,

  buildAuthUrl({ redirectUri, state, codeChallenge }: AuthUrlOptions): string {
    const { clientId } = credentials()

    if (!codeChallenge) {
      // The route supplies this whenever `usesPkce` is set, so reaching here
      // means the two have drifted apart — which would otherwise surface as an
      // unexplained `invalid_request` from X.
      throw new ConnectError(
        'provider_error',
        'X is not configured yet.',
        'missing PKCE challenge',
      )
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CHALLENGE_METHOD,
    })

    return `${AUTHORIZE}?${params.toString()}`
  },

  async exchangeCode(code, redirectUri, codeVerifier) {
    if (!codeVerifier) {
      throw new ConnectError(
        'provider_error',
        'That connection attempt expired. Please try again.',
        'missing PKCE verifier',
      )
    }

    const token = await requestToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    )

    const missing = missingScopes(SCOPES, token.scopes)
    if (missing.length) {
      throw new ConnectError(
        'missing_permissions',
        'X did not grant everything we need to post on your behalf.',
        `missing: ${missing.join(', ')}`,
      )
    }

    return token
  },

  async listAccounts(token) {
    const me = await api<{
      data?: { id: string; name: string; username: string; profile_image_url?: string }
    }>('/users/me?user.fields=profile_image_url', token.accessToken)

    if (!me.data) {
      throw new ConnectError(
        'wrong_account_type',
        'We could not read that X account.',
        'users/me returned no data',
      )
    }

    // One token, one account. X has no Pages-style hierarchy to choose from.
    return [
      {
        externalAccountId: me.data.id,
        displayName: me.data.name,
        username: me.data.username,
        avatarUrl: me.data.profile_image_url,
        accountType: 'profile',
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
      } satisfies DiscoveredAccount,
    ]
  },

  async refresh(token) {
    if (!token.refreshToken) return null

    // The response carries a NEW refresh token and invalidates this one. The
    // caller stores whatever comes back, or the connection is stranded.
    return requestToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    )
  },

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (request.media.length > 0) {
      // Media needs the chunked upload endpoint (INIT / APPEND / FINALIZE),
      // which is a different host and a different content type from everything
      // above. Refusing here is honest; pretending to post the text alone
      // would publish something nobody wrote.
      throw new PublishError(
        'Posting media to X is not built yet. Remove the attachments to post the text.',
        { retryable: false, ambiguous: false, detail: 'x media upload not implemented' },
      )
    }

    const result = await api<{ data?: { id: string } }>('/tweets', request.accessToken, {
      method: 'POST',
      body: JSON.stringify({ text: request.caption }),
    })

    if (!result.data?.id) {
      throw new PublishError('X accepted the request but returned no post.', {
        retryable: false,
        ambiguous: true,
        detail: 'no id in response',
      })
    }

    return {
      externalPostId: result.data.id,
      permalink: `https://x.com/i/web/status/${result.data.id}`,
      containerId: null,
    }
  },

  async findRecentlyPublished(request, since) {
    // X has no idempotency key either, so after an ambiguous failure the only
    // honest check is to look at what is actually on the timeline.
    const timeline = await api<{
      data?: { id: string; text: string; created_at?: string }[]
    }>(
      `/users/${request.externalAccountId}/tweets?max_results=10&tweet.fields=created_at`,
      request.accessToken,
    )

    const match = (timeline.data ?? []).find((tweet) => {
      if (tweet.text.trim() !== request.caption.trim()) return false
      if (!tweet.created_at) return true
      return new Date(tweet.created_at) >= since
    })

    if (!match) return null

    return {
      externalPostId: match.id,
      permalink: `https://x.com/i/web/status/${match.id}`,
      containerId: null,
    }
  },
}
