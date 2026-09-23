import 'server-only'

import { serverEnv } from '@/lib/env'
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
 * LinkedIn, via the versioned REST API.
 *
 * Two things shape this adapter.
 *
 * **Author URNs, not ids.** Everything LinkedIn publishes is attributed to a
 * `urn:li:person:...` or `urn:li:organization:...`, and the two take different
 * scopes. A member posts with `w_member_social`; a company Page needs
 * `w_organization_social` plus an admin role on that Page. We store the full
 * URN as the external account id, because it is what the publish call actually
 * needs and reconstructing it from a bare id is guesswork.
 *
 * **Refresh is a privilege.** LinkedIn issues refresh tokens only to approved
 * applications; everyone else gets a 60-day access token and nothing to renew
 * it with. `refresh()` returns null in that case, which is the contract's way
 * of saying the connection has to be redone — and is why the token-expiry
 * notice matters more here than on Meta.
 *
 * UNTESTED. Written from the documented API and never run: there are no
 * credentials, and LinkedIn's posting scopes require app review before they do
 * anything at all.
 */

const AUTHORIZE = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken'
const REST = 'https://api.linkedin.com/rest'
const OIDC = 'https://api.linkedin.com/v2/userinfo'

const SCOPES = [
  'openid',
  'profile',
  'w_member_social',
  'r_organization_admin',
  'w_organization_social',
] as const

function credentials(): { clientId: string; clientSecret: string } {
  const env = serverEnv()
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) {
    throw new ConnectError(
      'provider_error',
      'LinkedIn is not configured yet.',
      'LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET is unset',
    )
  }
  return {
    clientId: env.LINKEDIN_CLIENT_ID,
    clientSecret: env.LINKEDIN_CLIENT_SECRET,
  }
}

/** LinkedIn pins its REST API by date; an unset or stale one 426s. */
function restHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'LinkedIn-Version': serverEnv().LINKEDIN_API_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  }
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    })
  } catch (cause) {
    throw new ConnectError('provider_error', 'We could not reach LinkedIn.', String(cause))
  }

  const payload = (await response.json().catch(() => ({}))) as TokenResponse

  if (!response.ok || !payload.access_token) {
    throw new ConnectError(
      'provider_error',
      'LinkedIn would not complete the connection.',
      payload.error_description || payload.error || `HTTP ${response.status}`,
    )
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000)
      : undefined,
    scopes: payload.scope ? payload.scope.split(/[\s,]+/).filter(Boolean) : [...SCOPES],
  }
}

function classify(status: number, detail: string): PublishError {
  if (status === 429) {
    return new PublishError('LinkedIn is rate limiting us. We will try again shortly.', {
      retryable: true,
      ambiguous: false,
      detail,
    })
  }

  if (status === 401 || status === 403) {
    return new PublishError(
      'LinkedIn refused the connection. Reconnect the account to continue posting.',
      { retryable: false, ambiguous: false, detail },
    )
  }

  if (status >= 500) {
    return new PublishError('LinkedIn had a problem on their side.', {
      retryable: true,
      ambiguous: true,
      detail,
    })
  }

  return new PublishError('LinkedIn rejected this post.', {
    retryable: false,
    ambiguous: false,
    detail,
  })
}

export const linkedinAdapter: PlatformAdapter = {
  platform: 'linkedin',
  requiredScopes: SCOPES,

  buildAuthUrl({ redirectUri, state }: AuthUrlOptions): string {
    const { clientId } = credentials()

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES.join(' '),
    })

    return `${AUTHORIZE}?${params.toString()}`
  },

  async exchangeCode(code, redirectUri) {
    const { clientId, clientSecret } = credentials()

    const token = await requestToken(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    )

    // Only the member scopes are required. An account with no company Page is
    // a perfectly good connection, so the organisation scopes are optional and
    // their absence simply means no Pages are listed.
    const missing = missingScopes(['openid', 'profile', 'w_member_social'], token.scopes)
    if (missing.length) {
      throw new ConnectError(
        'missing_permissions',
        'LinkedIn did not grant everything we need to post on your behalf.',
        `missing: ${missing.join(', ')}`,
      )
    }

    return token
  },

  async listAccounts(token) {
    const accounts: DiscoveredAccount[] = []

    // --- the member themselves ---
    const meResponse = await fetch(OIDC, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      cache: 'no-store',
    }).catch(() => null)

    const me = (await meResponse?.json().catch(() => null)) as {
      sub?: string
      name?: string
      picture?: string
    } | null

    if (!me?.sub) {
      throw new ConnectError(
        'wrong_account_type',
        'We could not read that LinkedIn account.',
        'userinfo returned no subject',
      )
    }

    accounts.push({
      // The URN, not the bare id: it is what the publish call wants.
      externalAccountId: `urn:li:person:${me.sub}`,
      displayName: me.name ?? 'LinkedIn member',
      avatarUrl: me.picture,
      accountType: 'profile',
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
    })

    // --- company Pages they administer ---
    // Optional: without the organisation scopes this simply returns nothing,
    // and a member-only connection is still a usable one.
    if (token.scopes.includes('r_organization_admin')) {
      const orgResponse = await fetch(
        `${REST}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(id,localizedName,logoV2)))`,
        { headers: restHeaders(token.accessToken), cache: 'no-store' },
      ).catch(() => null)

      const orgs = (await orgResponse?.json().catch(() => null)) as {
        elements?: {
          'organization~'?: { id?: number; localizedName?: string }
        }[]
      } | null

      for (const element of orgs?.elements ?? []) {
        const org = element['organization~']
        if (!org?.id) continue

        accounts.push({
          externalAccountId: `urn:li:organization:${org.id}`,
          displayName: org.localizedName ?? `Organisation ${org.id}`,
          accountType: 'page',
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          scopes: token.scopes,
        })
      }
    }

    return accounts
  },

  async refresh(token) {
    // Only approved applications are issued one. Returning null is the
    // contract's way of saying "this has to be reconnected", which is the
    // truth rather than a silent failure later.
    if (!token.refreshToken) return null

    const { clientId, clientSecret } = credentials()

    return requestToken(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    )
  },

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (request.media.length > 0) {
      // Images go through initializeUpload, then a PUT of the bytes, then the
      // returned image URN in the post body — a different shape from the JSON
      // call below. Refusing is honest; silently posting the text alone is not.
      throw new PublishError(
        'Posting media to LinkedIn is not built yet. Remove the attachments to post the text.',
        { retryable: false, ambiguous: false, detail: 'linkedin media upload not implemented' },
      )
    }

    let response: Response
    try {
      response = await fetch(`${REST}/posts`, {
        method: 'POST',
        headers: restHeaders(request.accessToken),
        body: JSON.stringify({
          author: request.externalAccountId,
          commentary: request.caption,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
        cache: 'no-store',
      })
    } catch (cause) {
      throw new PublishError('We could not reach LinkedIn.', {
        retryable: true,
        ambiguous: false,
        detail: String(cause),
      })
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw classify(response.status, body.slice(0, 200) || `HTTP ${response.status}`)
    }

    // LinkedIn returns the new post's URN in a header rather than the body.
    const urn = response.headers.get('x-restli-id') ?? response.headers.get('x-linkedin-id')

    if (!urn) {
      throw new PublishError('LinkedIn accepted the post but did not say which one.', {
        retryable: false,
        ambiguous: true,
        detail: 'no x-restli-id header',
      })
    }

    return {
      externalPostId: urn,
      permalink: `https://www.linkedin.com/feed/update/${urn}`,
      containerId: null,
    }
  },

  async findRecentlyPublished() {
    // Reading a member's own recent posts needs scopes LinkedIn does not grant
    // for posting alone. Returning null means "cannot tell", and the worker
    // treats that as a refusal to retry rather than a licence to post twice —
    // which is the right way round when the alternative is a duplicate on a
    // client's company Page.
    return null
  },
}
