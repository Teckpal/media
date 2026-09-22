// Relative rather than the usual '@/' alias, and no `server-only`: Node's test
// runner resolves real paths and knows nothing about tsconfig. This module is
// pure on purpose so the shape of every publish can be asserted without a
// network, a database or a Meta app.
import { PLATFORM_LABELS, type Platform } from '../constants.ts'

/**
 * What a Meta publish actually is, decided before anything is sent.
 *
 * Facebook and Instagram do not have one "post" endpoint between them; they
 * have six, and which one applies depends on how many files there are and
 * whether they are stills or video. Working that out here — in a function with
 * no side effects — means the awkward cases (a video and photos in the same
 * post, an eleventh carousel slide) are answered by a test rather than by a
 * failed publish at 9am.
 *
 * `src/lib/posts/validation.ts` already refused the obvious ones when the post
 * was saved. This runs again at publish time because a post can sit scheduled
 * for weeks, and because the worker must never send a request it knows the
 * platform will reject.
 */

export type PlanMedia = {
  id: string
  mimeType: string
  url: string
  altText?: string | null
}

export type MetaPublishPlan =
  /** POST /{page-id}/feed */
  | { kind: 'facebook_text'; message: string }
  /** POST /{page-id}/photos */
  | { kind: 'facebook_photo'; message: string; photo: PlanMedia }
  /** Each photo uploaded unpublished, then attached to one feed post. */
  | { kind: 'facebook_multi_photo'; message: string; photos: PlanMedia[] }
  /** POST /{page-id}/videos */
  | { kind: 'facebook_video'; message: string; video: PlanMedia }
  /** Container, then publish. */
  | { kind: 'instagram_image'; caption: string; image: PlanMedia }
  | { kind: 'instagram_video'; caption: string; video: PlanMedia }
  /** A child container per slide, then one carousel container. */
  | { kind: 'instagram_carousel'; caption: string; items: PlanMedia[] }

export type PlanResult =
  | { ok: true; plan: MetaPublishPlan }
  | { ok: false; reason: string }

/** Instagram's limit, and Facebook's practical one for a single feed post. */
export const MAX_CAROUSEL_ITEMS = 10

export function isVideo(mimeType: string): boolean {
  return mimeType.startsWith('video/')
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

export function planMetaPublish(
  platform: Platform,
  post: { caption: string; media: PlanMedia[] },
): PlanResult {
  const label = PLATFORM_LABELS[platform]
  const caption = post.caption ?? ''
  const media = post.media ?? []

  const unknown = media.find((m) => !isImage(m.mimeType) && !isVideo(m.mimeType))
  if (unknown) {
    return { ok: false, reason: `${label} cannot post a ${unknown.mimeType} file.` }
  }

  if (media.length > MAX_CAROUSEL_ITEMS) {
    return {
      ok: false,
      reason: `${label} takes at most ${MAX_CAROUSEL_ITEMS} files in one post. This has ${media.length}.`,
    }
  }

  const videos = media.filter((m) => isVideo(m.mimeType))
  const images = media.filter((m) => isImage(m.mimeType))

  if (platform === 'facebook') {
    if (media.length === 0) {
      // Trimmed, because a caption of spaces is not a post.
      if (caption.trim().length === 0) {
        return { ok: false, reason: 'There is nothing to publish to Facebook.' }
      }
      return { ok: true, plan: { kind: 'facebook_text', message: caption } }
    }

    if (videos.length > 0) {
      // Not a platform limit we can work around: a Page video is its own kind
      // of post and cannot carry photos alongside it. Saying so plainly beats
      // silently dropping the photos.
      if (images.length > 0) {
        return {
          ok: false,
          reason: 'Facebook cannot publish a video and photos in the same post.',
        }
      }
      if (videos.length > 1) {
        return { ok: false, reason: 'Facebook takes one video per post.' }
      }
      return { ok: true, plan: { kind: 'facebook_video', message: caption, video: videos[0] } }
    }

    if (images.length === 1) {
      return { ok: true, plan: { kind: 'facebook_photo', message: caption, photo: images[0] } }
    }

    return { ok: true, plan: { kind: 'facebook_multi_photo', message: caption, photos: images } }
  }

  if (platform === 'instagram') {
    // The rule people are caught out by, and the reason validation runs per
    // platform rather than per post.
    if (media.length === 0) {
      return {
        ok: false,
        reason: 'Instagram cannot publish a post without an image or video.',
      }
    }

    if (media.length === 1) {
      const only = media[0]
      return isVideo(only.mimeType)
        ? { ok: true, plan: { kind: 'instagram_video', caption, video: only } }
        : { ok: true, plan: { kind: 'instagram_image', caption, image: only } }
    }

    // Instagram carousels take stills and video together, in the order the
    // user arranged them — which is why `media` is kept ordered all the way
    // down from the composer.
    return { ok: true, plan: { kind: 'instagram_carousel', caption, items: media } }
  }

  return { ok: false, reason: `${label} is not connected to publishing yet.` }
}
