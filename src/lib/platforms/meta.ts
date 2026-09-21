import 'server-only'

import { serverEnv } from '@/lib/env'
import {
  ConnectError,
  missingScopes,
  type AuthUrlOptions,
  type DiscoveredAccount,
  type IssuedToken,
  type PlatformAdapter,
} from '@/lib/platforms/types'
import type { Platform } from '@/lib/constants'

/**
 * Facebook Pages and Instagram business accounts — the Phase 1 platforms
 * (Section 11).
 *
 * They share one adapter because they share one OAuth flow: an Instagram
 * business account is reached through the Facebook Page it is linked to, with
 * that Page's token. Two entries in the registry, one implementation.
 *
 * VERSION: Meta ships a new Graph API version roughly quarterly and retires
 * old ones after about two years. `META_GRAPH_VERSION` pins it so an upgrade is
 * a config change; confirm the current version in the Meta app dashboard before
 * going live rather than trusting the default here.
 */

const graphVersion = () => serverEnv().META_GRAPH_VERSION
const graphBase = () => `https://graph.facebook.com/${graphVersion()}`
const dialogBase = () => `https://www.facebook.com/${graphVersion()}/dialog/oauth`

/**
 * Publishing to a Page needs `pages_manage_posts`; listing the Pages the user
 * administers needs `pages_show_list`; Instagram publishing needs both
 * `instagram_basic` and `instagram_content_publish`.
 *
 * `pages_read_engagement` is what makes the Page's own details readable, and is
 * the one Meta most often leaves out of a partial grant.
 */
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
] as const

type GraphError = { error?: { message?: string; type?: string; code?: number } }

async function graph<T>(url: string, context: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store' })
  } catch (cause) {
    throw new ConnectError(
      'provider_error',
      'Could not reach Facebook. Try again in a moment.',
      `${context}: ${String(cause)}`,
    )
  }

  const body = (await response.json().catch(() => ({}))) as T & GraphError

  if (!response.ok || body.error) {
    throw new ConnectError(
      'provider_error',
      'Facebook refused that request.',
      `${context}: ${body.error?.message ?? response.status}`,
    )
  }

  return body
}

function credentials() {
  const env = serverEnv()
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new ConnectError(
      'provider_error',
      'Facebook and Instagram are not configured yet.',
      'META_APP_ID or META_APP_SECRET is unset',
    )
  }
  return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET }
}

function expiryFromSeconds(seconds: number | undefined): Date | undefined {
  if (!seconds || seconds <= 0) return undefined
  return new Date(Date.now() + seconds * 1000)
}

class MetaAdapter implements PlatformAdapter {
  readonly platform: Platform
  readonly requiredScopes = META_SCOPES

  constructor(platform: Platform) {
    this.platform = platform
  }

  buildAuthUrl({ redirectUri, state }: AuthUrlOptions): string {
    const { appId } = credentials()

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: META_SCOPES.join(','),
      // Always re-show the picker. Without it a user who granted access to the
      // wrong Page has no way back — Meta silently reuses the old grant.
      auth_type: 'rerequest',
    })

    return `${dialogBase()}?${params}`
  }

  async exchangeCode(code: string, redirectUri: string): Promise<IssuedToken> {
    const { appId, appSecret } = credentials()

    const shortLived = await graph<{ access_token: string; expires_in?: number }>(
      `${graphBase()}/oauth/access_token?` +
        new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code,
        }),
      'exchange code',
    )

    // Short-lived user tokens last about an hour. Trading up to the ~60-day
    // one immediately is what lets the refresh cron keep a connection alive
    // without the user ever seeing it.
    const longLived = await graph<{ access_token: string; expires_in?: number }>(
      `${graphBase()}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLived.access_token,
        }),
      'exchange for long-lived token',
    )

    const scopes = await this.grantedScopes(longLived.access_token)

    return {
      accessToken: longLived.access_token,
      expiresAt: expiryFromSeconds(longLived.expires_in),
      scopes,
    }
  }

  /**
   * What the user actually ticked.
   *
   * Meta returns a grant even when some boxes were cleared, so asking is the
   * only way to tell a full grant from a partial one — and Section 6.1 wants
   * the partial case explained rather than failing later at publish time.
   */
  private async grantedScopes(accessToken: string): Promise<string[]> {
    const body = await graph<{ data?: { permission: string; status: string }[] }>(
      `${graphBase()}/me/permissions?` + new URLSearchParams({ access_token: accessToken }),
      'read granted permissions',
    )

    return (body.data ?? [])
      .filter((row) => row.status === 'granted')
      .map((row) => row.permission)
  }

  async listAccounts(token: IssuedToken): Promise<DiscoveredAccount[]> {
    const missing = missingScopes(META_SCOPES, token.scopes)
    if (missing.length > 0) {
      throw new ConnectError(
        'missing_permissions',
        'Some permissions were not granted.',
        `missing: ${missing.join(', ')}`,
      )
    }

    const body = await graph<{
      data?: {
        id: string
        name: string
        access_token: string
        picture?: { data?: { url?: string } }
        instagram_business_account?: {
          id: string
          username?: string
          name?: string
          profile_picture_url?: string
        }
      }[]
    }>(
      `${graphBase()}/me/accounts?` +
        new URLSearchParams({
          access_token: token.accessToken,
          fields:
            'id,name,access_token,picture{url},' +
            'instagram_business_account{id,username,name,profile_picture_url}',
          limit: '100',
        }),
      'list pages',
    )

    const pages = body.data ?? []

    if (pages.length === 0) {
      throw new ConnectError(
        'wrong_account_type',
        'No Facebook Page was found on that account.',
        'me/accounts returned nothing',
      )
    }

    if (this.platform === 'facebook') {
      return pages.map((page) => ({
        externalAccountId: page.id,
        displayName: page.name,
        avatarUrl: page.picture?.data?.url,
        accountType: 'page',
        // Page tokens derived from a long-lived user token do not expire, so
        // no expiresAt. The refresh cron watches the user token instead.
        accessToken: page.access_token,
        scopes: token.scopes,
      }))
    }

    const instagram = pages
      .filter((page) => page.instagram_business_account)
      .map((page) => {
        const ig = page.instagram_business_account!
        return {
          externalAccountId: ig.id,
          displayName: ig.name ?? ig.username ?? 'Instagram account',
          username: ig.username,
          avatarUrl: ig.profile_picture_url,
          accountType: 'business',
          // Instagram publishes through the Page, with the Page's token.
          parentExternalId: page.id,
          accessToken: page.access_token,
          scopes: token.scopes,
        }
      })

    if (instagram.length === 0) {
      throw new ConnectError(
        'wrong_account_type',
        'No Instagram business account is linked to your Pages.',
        'no instagram_business_account on any page',
      )
    }

    return instagram
  }

  /**
   * Meta has no refresh token. A long-lived user token is instead traded for a
   * fresh one while it is still valid, which is why the cron has to run well
   * before the ~60-day expiry rather than at it.
   */
  async refresh(token: IssuedToken): Promise<IssuedToken | null> {
    const { appId, appSecret } = credentials()

    const refreshed = await graph<{ access_token: string; expires_in?: number }>(
      `${graphBase()}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: token.accessToken,
        }),
      'refresh long-lived token',
    )

    return {
      accessToken: refreshed.access_token,
      expiresAt: expiryFromSeconds(refreshed.expires_in),
      scopes: token.scopes,
    }
  }
}

export const facebookAdapter = new MetaAdapter('facebook')
export const instagramAdapter = new MetaAdapter('instagram')
