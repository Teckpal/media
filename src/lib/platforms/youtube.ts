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
 * YouTube, via the Data API v3 and Google's OAuth.
 *
 * **A refresh token arrives once.** Google issues one only on the first
 * consent, unless the authorization request asks for `access_type=offline`
 * with `prompt=consent` — which this one does, deliberately. Without it a
 * reconnection returns an access token that dies in an hour and nothing to
 * renew it with, and the fault surfaces days later as a dead connection.
 *
 * **Upload is the whole job.** There is no post to write: a YouTube post is a
 * video file, and the API takes it through a resumable upload session rather
 * than a URL it fetches. That is a streaming job with its own retry semantics,
 * and it is not built here — `publish` says so rather than pretending.
 *
 * UNTESTED. Written from the documented API; there are no credentials, and
 * the upload scope requires Google verification before it works outside a test
 * user list.
 */

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/youtube/v3'

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const

function credentials(): { clientId: string; clientSecret: string } {
  const env = serverEnv()
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new ConnectError(
      'provider_error',
      'YouTube is not configured yet.',
      'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is unset',
    )
  }
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
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
  const { clientId, clientSecret } = credentials()

  let response: Response
  try {
    response = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        ...extra,
      }),
      cache: 'no-store',
    })
  } catch (cause) {
    throw new ConnectError('provider_error', 'We could not reach Google.', String(cause))
  }

  const payload = (await response.json().catch(() => ({}))) as TokenResponse

  if (!response.ok || !payload.access_token) {
    throw new ConnectError(
      'provider_error',
      'Google would not complete the connection.',
      payload.error_description || payload.error || `HTTP ${response.status}`,
    )
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000)
      : undefined,
    scopes: payload.scope ? payload.scope.split(' ').filter(Boolean) : [...SCOPES],
  }
}

export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',
  requiredScopes: SCOPES,

  buildAuthUrl({ redirectUri, state }: AuthUrlOptions): string {
    const { clientId } = credentials()

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
      // Both are required together. `offline` asks for a refresh token;
      // `consent` makes Google issue a new one even for a returning user, who
      // would otherwise be sent back with an access token and nothing to
      // renew it with.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    })

    return `${AUTHORIZE}?${params.toString()}`
  },

  async exchangeCode(code, redirectUri) {
    const token = await requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    })

    const missing = missingScopes(SCOPES, token.scopes)
    if (missing.length) {
      throw new ConnectError(
        'missing_permissions',
        'Google did not grant everything we need to upload on your behalf.',
        `missing: ${missing.join(', ')}`,
      )
    }

    if (!token.refreshToken) {
      // Worth failing the connection over. An access token alone lasts an hour,
      // and accepting it would produce a connection that silently dies today.
      throw new ConnectError(
        'missing_permissions',
        'Google did not return a refresh token. Remove this app from your Google account permissions and connect again.',
        'no refresh_token despite access_type=offline',
      )
    }

    return token
  },

  async listAccounts(token) {
    let response: Response
    try {
      response = await fetch(`${API}/channels?part=snippet,contentDetails&mine=true`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        cache: 'no-store',
      })
    } catch (cause) {
      throw new ConnectError('provider_error', 'We could not reach YouTube.', String(cause))
    }

    const body = (await response.json().catch(() => ({}))) as {
      items?: {
        id?: string
        snippet?: {
          title?: string
          customUrl?: string
          thumbnails?: { default?: { url?: string } }
        }
      }[]
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new ConnectError(
        'provider_error',
        'YouTube would not tell us about that account.',
        body.error?.message ?? `HTTP ${response.status}`,
      )
    }

    const channels = (body.items ?? []).filter((item) => item.id)

    if (channels.length === 0) {
      // A Google account without a channel cannot receive a video. Saying so
      // here is Section 6.1's "wrong account type" screen, not a crash later.
      throw new ConnectError(
        'wrong_account_type',
        'That Google account has no YouTube channel. Create one, then connect again.',
        'channels?mine=true returned nothing',
      )
    }

    return channels.map(
      (channel): DiscoveredAccount => ({
        externalAccountId: channel.id!,
        displayName: channel.snippet?.title ?? 'YouTube channel',
        username: channel.snippet?.customUrl ?? undefined,
        avatarUrl: channel.snippet?.thumbnails?.default?.url,
        accountType: 'channel',
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
      }),
    )
  },

  async refresh(token) {
    if (!token.refreshToken) return null

    const refreshed = await requestToken({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    })

    // Google does not resend the refresh token on a renewal, so it is carried
    // forward here — otherwise the next refresh has nothing to work with.
    return { ...refreshed, refreshToken: refreshed.refreshToken ?? token.refreshToken }
  },

  async publish(request: PublishRequest): Promise<PublishResult> {
    const video = request.media.find((item) => item.mimeType.startsWith('video/'))

    if (!video) {
      throw new PublishError('YouTube needs a video. This post has none.', {
        retryable: false,
        ambiguous: false,
        detail: 'no video in media',
      })
    }

    // A resumable upload session, streaming the bytes from our bucket and
    // handling its own restarts. That is a real piece of work and it is not
    // built — so this refuses rather than looking like it might have worked.
    throw new PublishError(
      'Uploading to YouTube is not built yet.',
      { retryable: false, ambiguous: false, detail: 'youtube resumable upload not implemented' },
    )
  },

  async findRecentlyPublished() {
    // Nothing is ever sent, so nothing can have landed.
    return null
  },
}
