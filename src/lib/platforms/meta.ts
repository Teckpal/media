import 'server-only'

import { serverEnv } from '@/lib/env'
import {
  ConnectError,
  missingScopes,
  PublishError,
  type AuthUrlOptions,
  type DiscoveredAccount,
  type IssuedToken,
  type PlatformAdapter,
  type PublishRequest,
  type PublishResult,
} from '@/lib/platforms/types'
import { planMetaPublish, type MetaPublishPlan } from '@/lib/platforms/meta-plan'
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


// --- the publishing half of the Graph client (Module 6) ----------------------
//
// Connecting and publishing fail differently, so they raise different errors.
// A connect failure has a screen of its own (Section 6.1); a publish failure
// has to decide whether to try again, and that decision is only as good as the
// classification below.

/** How long a single Graph request may take before it is given up on. */
const GRAPH_TIMEOUT_MS = 20_000
/** How long to wait for Instagram to finish with a container, within one tick. */
const CONTAINER_WAIT_MS = 25_000
const CONTAINER_POLL_MS = 3_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Meta error codes that will not improve by being asked again.
 *
 * Retrying these wastes the attempt budget and, worse, delays the notification
 * that tells the user to do something — reconnect the account, fix the file.
 */
const PERMANENT_CODES = new Set([
  3, // the app cannot perform this action
  10, // permission denied — the app lacks a reviewed permission
  100, // invalid parameter: a bad media URL, an over-long caption
  190, // the access token is invalid or has expired
  200, // permission denied for this Page or account
  1609005, // could not fetch the linked image
  2207003, // Instagram could not fetch the media
  2207020, // the media is no longer available
  2207026, // unsupported video format
])

/** Codes that mean "not now" rather than "no". */
const RETRYABLE_CODES = new Set([
  1, // unknown transient error
  2, // service temporarily unavailable
  4, // application-level rate limit
  17, // user-level rate limit
  32, // Page-level rate limit
  613, // calls-per-second limit
  80004, // Instagram content publishing rate limit
])

function classify(code: number | undefined, httpStatus: number): boolean {
  if (code !== undefined) {
    if (RETRYABLE_CODES.has(code)) return true
    if (PERMANENT_CODES.has(code)) return false
  }

  // Unknown code. A 5xx is the platform's problem and worth repeating; a 4xx is
  // ours and will be refused just as firmly next time.
  return httpStatus >= 500 || httpStatus === 429
}

/**
 * A Graph read.
 *
 * Failures here are never ambiguous: reading nothing changes nothing, so the
 * caller is free to try again.
 */
async function graphGet<T>(url: string, context: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new PublishError('Could not reach Facebook. We will try again shortly.', {
      retryable: true,
      detail: `${context}: ${String(cause)}`,
    })
  }

  const body = (await response.json().catch(() => ({}))) as T & GraphError

  if (!response.ok || body.error) {
    throw new PublishError(messageFor(body.error), {
      retryable: classify(body.error?.code, response.status),
      detail: `${context}: ${body.error?.message ?? response.status}`,
    })
  }

  return body
}

/**
 * A Graph write.
 *
 * The difference that matters: if the connection drops or the request times
 * out, the post may well have been created. That is recorded as `ambiguous`,
 * and the worker goes and looks rather than sending it again.
 */
async function graphPost<T>(
  url: string,
  fields: Record<string, string>,
  context: string,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      // Form-encoded, so the access token stays out of the URL and therefore
      // out of any intermediate log.
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new PublishError('Facebook stopped responding while we were posting.', {
      retryable: true,
      ambiguous: true,
      detail: `${context}: ${String(cause)}`,
    })
  }

  const body = (await response.json().catch(() => ({}))) as T & GraphError

  if (!response.ok || body.error) {
    throw new PublishError(messageFor(body.error), {
      retryable: classify(body.error?.code, response.status),
      // A 5xx may have been raised after the write landed; a 4xx was refused
      // before it. Only the first is worth reconciling.
      ambiguous: response.status >= 500,
      detail: `${context}: [${body.error?.code ?? response.status}] ${
        body.error?.message ?? 'no message'
      }`,
    })
  }

  return body
}

/**
 * What the user reads.
 *
 * Meta's own message is not shown verbatim — it is written for developers and
 * sometimes names internal objects — except where it is the only thing that
 * explains the refusal.
 */
function messageFor(error: GraphError['error']): string {
  switch (error?.code) {
    case 190:
      return 'We lost access to this account. Reconnect it and schedule the post again.'
    case 200:
    case 10:
    case 3:
      return 'This account has not granted the permission needed to publish.'
    case 4:
    case 17:
    case 32:
    case 613:
    case 80004:
      return 'The platform is rate-limiting us. We will try again shortly.'
    case 2207026:
      return 'That video format is not supported.'
    case 2207003:
    case 1609005:
      return 'The platform could not fetch the media for this post.'
    default:
      return error?.message
        ? `The platform refused this post: ${error.message}`
        : 'The platform refused this post.'
  }
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

  // --- publishing (Module 6) -------------------------------------------------

  /**
   * Sends the post.
   *
   * Facebook and Instagram publish in quite different shapes — Facebook takes
   * one request per kind of post, Instagram builds a container and then
   * publishes it — so the plan is worked out first (`meta-plan.ts`, pure and
   * tested) and only then executed.
   */
  async publish(request: PublishRequest): Promise<PublishResult> {
    const planned = planMetaPublish(this.platform, {
      caption: request.caption,
      media: request.media,
    })

    if (!planned.ok) {
      // The platform would refuse this, so there is no point asking it to.
      // Not retryable: nothing about waiting changes what is in the post.
      throw new PublishError(planned.reason, {
        retryable: false,
        detail: `plan refused: ${planned.reason}`,
      })
    }

    return this.platform === 'facebook'
      ? this.publishToPage(request, planned.plan)
      : this.publishToInstagram(request, planned.plan)
  }

  // --- Facebook --------------------------------------------------------------

  private async publishToPage(
    request: PublishRequest,
    plan: MetaPublishPlan,
  ): Promise<PublishResult> {
    const page = request.externalAccountId
    const token = request.accessToken

    switch (plan.kind) {
      case 'facebook_text': {
        const created = await graphPost<{ id: string }>(
          `${graphBase()}/${page}/feed`,
          { message: plan.message, access_token: token },
          'publish page post',
        )
        return this.withPermalink(created.id, token)
      }

      case 'facebook_photo': {
        // A photo post returns both the photo id and the feed story it became.
        // The story is what a person means by "the post", so that is what gets
        // recorded and linked to.
        const created = await graphPost<{ id: string; post_id?: string }>(
          `${graphBase()}/${page}/photos`,
          { url: plan.photo.url, caption: plan.message, access_token: token },
          'publish page photo',
        )
        return this.withPermalink(created.post_id ?? created.id, token)
      }

      case 'facebook_multi_photo': {
        // Each photo is uploaded unpublished first, then attached to one feed
        // post. In sequence rather than in parallel: Meta rate-limits per Page,
        // and a refusal halfway through a parallel upload would leave photos in
        // the Page's library with no post to belong to.
        const attached: { media_fbid: string }[] = []

        for (const photo of plan.photos) {
          const uploaded = await graphPost<{ id: string }>(
            `${graphBase()}/${page}/photos`,
            { url: photo.url, published: 'false', access_token: token },
            'upload unpublished photo',
          )
          attached.push({ media_fbid: uploaded.id })
        }

        const created = await graphPost<{ id: string }>(
          `${graphBase()}/${page}/feed`,
          {
            message: plan.message,
            attached_media: JSON.stringify(attached),
            access_token: token,
          },
          'publish multi-photo post',
        )
        return this.withPermalink(created.id, token)
      }

      case 'facebook_video': {
        const created = await graphPost<{ id: string }>(
          `${graphBase()}/${page}/videos`,
          { file_url: plan.video.url, description: plan.message, access_token: token },
          'publish page video',
        )
        // A freshly uploaded video has no permalink until Meta finishes
        // encoding it, so the absence of one here is not an error.
        return { externalPostId: created.id, permalink: null }
      }

      default:
        throw new PublishError('That post cannot be published to Facebook.', {
          retryable: false,
          detail: `unexpected plan ${plan.kind} for facebook`,
        })
    }
  }

  /** Best effort. A missing permalink is cosmetic; it must not fail a publish. */
  private async withPermalink(id: string, token: string): Promise<PublishResult> {
    try {
      const details = await graphGet<{ permalink_url?: string }>(
        `${graphBase()}/${id}?` +
          new URLSearchParams({ fields: 'permalink_url', access_token: token }),
        'read permalink',
      )
      return { externalPostId: id, permalink: details.permalink_url ?? null }
    } catch {
      return { externalPostId: id, permalink: null }
    }
  }

  // --- Instagram -------------------------------------------------------------

  /**
   * Container, then publish.
   *
   * The container id is carried back out on every failure path that has one,
   * because a retry that rebuilds the container is a retry that can publish
   * twice. Resuming the same container is the only idempotency Meta offers.
   */
  private async publishToInstagram(
    request: PublishRequest,
    plan: MetaPublishPlan,
  ): Promise<PublishResult> {
    const igUser = request.externalAccountId
    const token = request.accessToken

    const containerId =
      request.containerId ?? (await this.createInstagramContainer(igUser, token, plan))

    // Video and carousel containers are processed asynchronously. Publishing
    // one that is not ready fails, so the state is checked first — and a
    // container still being worked on is reported as processing rather than as
    // a failure, which costs no attempt and lets the next tick resume it.
    await this.awaitContainerReady(containerId, token)

    let published: { id: string }
    try {
      published = await graphPost<{ id: string }>(
        `${graphBase()}/${igUser}/media_publish`,
        { creation_id: containerId, access_token: token },
        'publish instagram container',
      )
    } catch (cause) {
      // Re-thrown carrying the container, so the retry resumes this one.
      if (cause instanceof PublishError) {
        throw new PublishError(cause.userMessage, {
          retryable: cause.retryable,
          ambiguous: cause.ambiguous,
          stillProcessing: cause.stillProcessing,
          containerId,
          detail: cause.detail,
        })
      }
      throw cause
    }

    const result = await this.instagramPermalink(published.id, token)
    return { ...result, containerId }
  }

  private async createInstagramContainer(
    igUser: string,
    token: string,
    plan: MetaPublishPlan,
  ): Promise<string> {
    if (plan.kind === 'instagram_image') {
      const container = await graphPost<{ id: string }>(
        `${graphBase()}/${igUser}/media`,
        {
          image_url: plan.image.url,
          caption: plan.caption,
          ...(plan.image.altText ? { alt_text: plan.image.altText } : {}),
          access_token: token,
        },
        'create instagram image container',
      )
      return container.id
    }

    if (plan.kind === 'instagram_video') {
      const container = await graphPost<{ id: string }>(
        `${graphBase()}/${igUser}/media`,
        {
          media_type: 'REELS',
          video_url: plan.video.url,
          caption: plan.caption,
          access_token: token,
        },
        'create instagram video container',
      )
      return container.id
    }

    if (plan.kind === 'instagram_carousel') {
      const children: string[] = []

      for (const item of plan.items) {
        const child = await graphPost<{ id: string }>(
          `${graphBase()}/${igUser}/media`,
          {
            is_carousel_item: 'true',
            ...(item.mimeType.startsWith('video/')
              ? { media_type: 'VIDEO', video_url: item.url }
              : { image_url: item.url }),
            ...(item.altText ? { alt_text: item.altText } : {}),
            access_token: token,
          },
          'create carousel child',
        )
        children.push(child.id)
      }

      return (
        await graphPost<{ id: string }>(
          `${graphBase()}/${igUser}/media`,
          {
            media_type: 'CAROUSEL',
            children: children.join(','),
            caption: plan.caption,
            access_token: token,
          },
          'create carousel container',
        )
      ).id
    }

    throw new PublishError('That post cannot be published to Instagram.', {
      retryable: false,
      detail: `unexpected plan ${plan.kind} for instagram`,
    })
  }

  /**
   * Waits a short while for Meta to finish with a container.
   *
   * Short, because this runs inside a serverless invocation with a hard
   * ceiling. A container that is not ready within the budget is not a failure:
   * it is handed back as `stillProcessing`, its id is kept, and the next tick
   * resumes exactly where this one stopped.
   */
  private async awaitContainerReady(containerId: string, token: string): Promise<void> {
    const deadline = Date.now() + CONTAINER_WAIT_MS

    for (;;) {
      const state = await graphGet<{ status_code?: string; status?: string }>(
        `${graphBase()}/${containerId}?` +
          new URLSearchParams({ fields: 'status_code,status', access_token: token }),
        'read container status',
      )

      // An image container is ready the moment it exists and may not report a
      // status at all, so a missing one is read as finished rather than as a
      // reason to wait.
      const status = state.status_code ?? 'FINISHED'

      if (status === 'FINISHED') return

      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new PublishError(
          'Instagram could not process that file. Check the format and try again.',
          {
            retryable: false,
            detail: `container ${containerId}: ${status} ${state.status ?? ''}`.trim(),
          },
        )
      }

      if (Date.now() + CONTAINER_POLL_MS >= deadline) {
        throw new PublishError('Instagram is still processing this post.', {
          retryable: true,
          stillProcessing: true,
          containerId,
          detail: `container ${containerId} still ${status} after ${CONTAINER_WAIT_MS}ms`,
        })
      }

      await sleep(CONTAINER_POLL_MS)
    }
  }

  private async instagramPermalink(mediaId: string, token: string): Promise<PublishResult> {
    try {
      const details = await graphGet<{ permalink?: string }>(
        `${graphBase()}/${mediaId}?` +
          new URLSearchParams({ fields: 'permalink', access_token: token }),
        'read instagram permalink',
      )
      return { externalPostId: mediaId, permalink: details.permalink ?? null }
    } catch {
      return { externalPostId: mediaId, permalink: null }
    }
  }

  // --- reconciliation --------------------------------------------------------

  /**
   * Did the last attempt land after all?
   *
   * The Graph API has no idempotency key, so after a timeout the only way to
   * find out is to look at what the account has published since the attempt
   * began. The caption is what identifies it — which means a post with no
   * caption cannot be identified at all, and this says so by returning null
   * rather than guessing. The worker reads null as "do not retry", so the
   * failure mode is a post somebody has to check by hand, never a duplicate.
   */
  async findRecentlyPublished(
    request: PublishRequest,
    since: Date,
  ): Promise<PublishResult | null> {
    const caption = request.caption.trim()
    if (caption.length === 0) return null

    const edge = this.platform === 'facebook' ? 'feed' : 'media'
    const fields =
      this.platform === 'facebook'
        ? 'id,message,created_time,permalink_url'
        : 'id,caption,timestamp,permalink'

    try {
      const body = await graphGet<{
        data?: {
          id: string
          message?: string
          caption?: string
          created_time?: string
          timestamp?: string
          permalink_url?: string
          permalink?: string
        }[]
      }>(
        `${graphBase()}/${request.externalAccountId}/${edge}?` +
          new URLSearchParams({
            fields,
            limit: '25',
            access_token: request.accessToken,
          }),
        'look for an already-published post',
      )

      // Filtered here rather than with a `since` parameter, whose support
      // varies by edge. A minute of slack covers the clock difference between
      // this server and Meta's.
      const floor = since.getTime() - 60_000

      const match = (body.data ?? []).find((row) => {
        const text = (row.message ?? row.caption ?? '').trim()
        if (text !== caption) return false

        const at = Date.parse(row.created_time ?? row.timestamp ?? '')
        return Number.isNaN(at) ? false : at >= floor
      })

      if (!match) return null

      return {
        externalPostId: match.id,
        permalink: match.permalink_url ?? match.permalink ?? null,
      }
    } catch {
      // Cannot tell. The same answer as "not found", and the caller treats both
      // as a reason to stop rather than to send again.
      return null
    }
  }
}

export const facebookAdapter = new MetaAdapter('facebook')
export const instagramAdapter = new MetaAdapter('instagram')
