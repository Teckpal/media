import 'server-only'

import { serverEnv } from '@/lib/env'
import { CHALLENGE_METHOD } from '@/lib/platforms/pkce'
import {
  ConnectError,
  PublishError,
  missingScopes,
  type AuthUrlOptions,
  type IssuedToken,
  type PlatformAdapter,
  type PublishRequest,
  type PublishResult,
} from '@/lib/platforms/types'

/**
 * TikTok, Content Posting API v2.
 *
 * The awkward one, in three ways.
 *
 * **Video only, and nothing else.** There is no text post. A caption without a
 * video cannot be published at all, which is why the composer refuses it
 * before anybody schedules one (see `validation.ts`).
 *
 * **Publishing is asynchronous.** `init` returns a `publish_id`, TikTok then
 * fetches the file and transcodes it, and the result arrives minutes later
 * from a separate status endpoint. So `publish` cannot return a post id — it
 * returns the publish id as a container and raises `stillProcessing`, which
 * the worker already understands from Instagram's video containers: come back
 * later, and do not spend an attempt waiting.
 *
 * **PULL_FROM_URL needs a verified domain.** TikTok will only fetch from a
 * domain proved to belong to the app, via a file it serves. Until that is
 * done, every publish fails with `url_ownership_unverified` no matter how
 * correct the rest is.
 *
 * UNTESTED. Written from the documented API; there are no credentials, and
 * TikTok gates the posting scopes behind app review.
 */

const AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/'
const API = 'https://open.tiktokapis.com/v2'

const SCOPES = ['user.info.basic', 'video.publish'] as const

function credentials(): { clientKey: string; clientSecret: string } {
  const env = serverEnv()
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
    throw new ConnectError(
      'provider_error',
      'TikTok is not configured yet.',
      'TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET is unset',
    )
  }
  return { clientKey: env.TIKTOK_CLIENT_KEY, clientSecret: env.TIKTOK_CLIENT_SECRET }
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function requestToken(extra: Record<string, string>): Promise<IssuedToken> {
  const { clientKey, clientSecret } = credentials()

  let response: Response
  try {
    response = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        ...extra,
      }),
      cache: 'no-store',
    })
  } catch (cause) {
    throw new ConnectError('provider_error', 'We could not reach TikTok.', String(cause))
  }

  const payload = (await response.json().catch(() => ({}))) as TokenResponse

  if (!response.ok || !payload.access_token) {
    throw new ConnectError(
      'provider_error',
      'TikTok would not complete the connection.',
      payload.error_description || payload.error || `HTTP ${response.status}`,
    )
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000)
      : undefined,
    scopes: payload.scope ? payload.scope.split(',').filter(Boolean) : [...SCOPES],
  }
}

export const tiktokAdapter: PlatformAdapter = {
  platform: 'tiktok',
  requiredScopes: SCOPES,
  usesPkce: true,

  buildAuthUrl({ redirectUri, state, codeChallenge }: AuthUrlOptions): string {
    const { clientKey } = credentials()

    if (!codeChallenge) {
      throw new ConnectError(
        'provider_error',
        'TikTok is not configured yet.',
        'missing PKCE challenge',
      )
    }

    const params = new URLSearchParams({
      client_key: clientKey,
      response_type: 'code',
      scope: SCOPES.join(','),
      redirect_uri: redirectUri,
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

    const token = await requestToken({
      grant_type: 'authorization_code',
      // TikTok URL-encodes the code into the redirect; it must be decoded once
      // before being sent back, or the exchange fails as invalid.
      code: decodeURIComponent(code),
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })

    const missing = missingScopes(SCOPES, token.scopes)
    if (missing.length) {
      throw new ConnectError(
        'missing_permissions',
        'TikTok did not grant everything we need to post on your behalf.',
        `missing: ${missing.join(', ')}`,
      )
    }

    return token
  },

  async listAccounts(token) {
    let response: Response
    try {
      response = await fetch(
        `${API}/user/info/?fields=open_id,display_name,avatar_url,username`,
        {
          headers: { Authorization: `Bearer ${token.accessToken}` },
          cache: 'no-store',
        },
      )
    } catch (cause) {
      throw new ConnectError('provider_error', 'We could not reach TikTok.', String(cause))
    }

    const body = (await response.json().catch(() => ({}))) as {
      data?: {
        user?: {
          open_id?: string
          display_name?: string
          avatar_url?: string
          username?: string
        }
      }
      error?: { message?: string; code?: string }
    }

    const user = body.data?.user
    if (!response.ok || !user?.open_id) {
      throw new ConnectError(
        'wrong_account_type',
        'We could not read that TikTok account.',
        body.error?.message || body.error?.code || `HTTP ${response.status}`,
      )
    }

    return [
      {
        externalAccountId: user.open_id,
        displayName: user.display_name ?? 'TikTok account',
        username: user.username,
        avatarUrl: user.avatar_url,
        accountType: 'profile',
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
      },
    ]
  },

  async refresh(token) {
    if (!token.refreshToken) return null
    return requestToken({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    })
  },

  async publish(request: PublishRequest): Promise<PublishResult> {
    const video = request.media.find((item) => item.mimeType.startsWith('video/'))

    if (!video) {
      throw new PublishError('TikTok needs a video. This post has none.', {
        retryable: false,
        ambiguous: false,
        detail: 'no video in media',
      })
    }

    let response: Response
    try {
      response = await fetch(`${API}/post/publish/video/init/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          post_info: {
            title: request.caption.slice(0, 2_200),
            privacy_level: 'SELF_ONLY',
            disable_comment: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            // A signed, time-limited link into our own bucket. TikTok fetches
            // it rather than accepting an upload, so it has to outlive the call.
            video_url: video.url,
          },
        }),
        cache: 'no-store',
      })
    } catch (cause) {
      throw new PublishError('We could not reach TikTok.', {
        retryable: true,
        ambiguous: false,
        detail: String(cause),
      })
    }

    const body = (await response.json().catch(() => ({}))) as {
      data?: { publish_id?: string }
      error?: { code?: string; message?: string }
    }

    if (!response.ok || !body.data?.publish_id) {
      const code = body.error?.code ?? `HTTP ${response.status}`
      const detail = body.error?.message ?? code

      if (code === 'url_ownership_unverified') {
        throw new PublishError(
          'TikTok will not fetch media from this site until the domain is verified with them.',
          { retryable: false, ambiguous: false, detail },
        )
      }

      if (response.status === 429 || response.status >= 500) {
        throw new PublishError('TikTok is busy. We will try again shortly.', {
          retryable: true,
          ambiguous: response.status >= 500,
          detail,
        })
      }

      throw new PublishError('TikTok rejected this post.', {
        retryable: false,
        ambiguous: false,
        detail,
      })
    }

    // Accepted, not published. TikTok is now fetching and transcoding, and the
    // post id only exists once that finishes — so this reports back the way an
    // Instagram video container does and lets the worker return later.
    throw new PublishError('TikTok is still processing this video.', {
      retryable: true,
      ambiguous: false,
      stillProcessing: true,
      containerId: body.data.publish_id,
      detail: `publish_id ${body.data.publish_id}`,
    })
  },

  async findRecentlyPublished(request) {
    // The honest reconciliation for TikTok is the publish status endpoint, and
    // it needs the publish id from the attempt that failed. Without one there
    // is nothing to ask about, and "cannot tell" must not become "send again".
    if (!request.containerId) return null

    let response: Response
    try {
      response = await fetch(`${API}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: request.containerId }),
        cache: 'no-store',
      })
    } catch {
      return null
    }

    const body = (await response.json().catch(() => ({}))) as {
      data?: { status?: string; publicaly_available_post_id?: string[] }
    }

    const postId = body.data?.publicaly_available_post_id?.[0]
    if (body.data?.status !== 'PUBLISH_COMPLETE' || !postId) return null

    return { externalPostId: postId, permalink: null, containerId: request.containerId }
  },
}
