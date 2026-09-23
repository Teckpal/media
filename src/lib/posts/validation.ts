// Relative rather than the usual '@/' alias: Node's test runner resolves real
// paths and knows nothing about tsconfig, and this module is one of the pure
// ones that is unit-tested directly.
import { PLATFORM_LABELS, type Platform } from '../constants.ts'

/**
 * Section 6.2: "Edit a scheduled post — re-validate media + caption per
 * platform."
 *
 * A post fanned out to Facebook and Instagram has to satisfy both, and their
 * rules disagree: Facebook takes text on its own, Instagram refuses to publish
 * without an image. Catching that here, when the post is saved, is the
 * difference between a clear message now and a failed publish at 9am.
 *
 * Pure on purpose — no database, no network — so it can be tested directly and
 * run identically on the server and in the composer.
 */

export type MediaItem = {
  id: string
  mimeType: string
  byteSize?: number | null
  width?: number | null
  height?: number | null
  durationMs?: number | null
}

export type ValidationIssue = {
  platform: Platform
  /** 'caption' | 'media' — which half of the composer to point at. */
  field: 'caption' | 'media'
  message: string
  /** A warning does not stop a save; an error does. */
  severity: 'error' | 'warning'
}

type Limits = {
  captionMax: number
  mediaRequired: boolean
  maxMedia: number
  /** Instagram rejects anything outside 4:5 to 1.91:1. */
  aspectRatio?: { min: number; max: number }
  maxHashtags?: number
  imageTypes: readonly string[]
  videoTypes: readonly string[]
  maxVideoMs?: number
}

/**
 * Phase 1 limits, as published by the platforms.
 *
 * These move. They are gathered here rather than scattered through the
 * composer so that when Instagram changes a number it is changed once — and so
 * a reviewer can see at a glance what the app believes.
 */
const LIMITS: Partial<Record<Platform, Limits>> = {
  facebook: {
    captionMax: 63_206,
    mediaRequired: false,
    maxMedia: 10,
    imageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    videoTypes: ['video/mp4', 'video/quicktime'],
    maxVideoMs: 4 * 60 * 60 * 1000,
  },
  instagram: {
    captionMax: 2_200,
    // The one that catches people out: Instagram has no text-only post.
    mediaRequired: true,
    maxMedia: 10,
    aspectRatio: { min: 4 / 5, max: 1.91 },
    maxHashtags: 30,
    imageTypes: ['image/jpeg', 'image/png'],
    videoTypes: ['video/mp4', 'video/quicktime'],
    maxVideoMs: 15 * 60 * 1000,
  },

  // 280 on a free or basic plan. Premium raises it, but the composer should
  // warn against the limit almost everybody has rather than the best case.
  twitter: {
    captionMax: 280,
    mediaRequired: false,
    maxMedia: 4,
    imageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    videoTypes: ['video/mp4'],
    maxVideoMs: 140 * 1000,
  },

  linkedin: {
    captionMax: 3_000,
    mediaRequired: false,
    maxMedia: 20,
    imageTypes: ['image/jpeg', 'image/png', 'image/gif'],
    videoTypes: ['video/mp4'],
    maxVideoMs: 30 * 60 * 1000,
  },

  // No text post exists on either of these. A caption with nothing attached
  // cannot be published at all, so the composer refuses it here rather than
  // letting somebody schedule a post that can only fail at 9am.
  tiktok: {
    captionMax: 2_200,
    mediaRequired: true,
    maxMedia: 1,
    imageTypes: [],
    videoTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    maxVideoMs: 10 * 60 * 1000,
  },

  youtube: {
    // The video's own title, not a description: the API caps it at 100 and
    // rejects angle brackets outright.
    captionMax: 100,
    mediaRequired: true,
    maxMedia: 1,
    imageTypes: [],
    videoTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    maxVideoMs: 12 * 60 * 60 * 1000,
  },
}

export function countHashtags(caption: string): number {
  return (caption.match(/(^|\s)#[^\s#]+/g) ?? []).length
}

export function validateForPlatform(
  platform: Platform,
  post: { caption: string; media: MediaItem[] },
): ValidationIssue[] {
  const limits = LIMITS[platform]
  const label = PLATFORM_LABELS[platform]

  // No limits recorded means no adapter either, so there is nothing to check
  // and nothing that could publish.
  if (!limits) return []

  const issues: ValidationIssue[] = []
  const add = (
    field: ValidationIssue['field'],
    message: string,
    severity: ValidationIssue['severity'] = 'error',
  ) => issues.push({ platform, field, message, severity })

  const caption = post.caption.trim()

  if (caption.length > limits.captionMax) {
    add(
      'caption',
      `${label} allows ${limits.captionMax.toLocaleString()} characters. This is ${caption.length.toLocaleString()}.`,
    )
  }

  if (limits.maxHashtags !== undefined) {
    const hashtags = countHashtags(post.caption)
    if (hashtags > limits.maxHashtags) {
      add('caption', `${label} allows ${limits.maxHashtags} hashtags. This has ${hashtags}.`)
    }
  }

  if (post.media.length === 0) {
    if (limits.mediaRequired) {
      add('media', `${label} cannot publish a post without an image or video.`)
    } else if (caption.length === 0) {
      add('caption', `There is nothing to publish to ${label}.`)
    }
    return issues
  }

  if (post.media.length > limits.maxMedia) {
    add('media', `${label} allows ${limits.maxMedia} items. This has ${post.media.length}.`)
  }

  const allowed = [...limits.imageTypes, ...limits.videoTypes]

  for (const item of post.media) {
    if (!allowed.includes(item.mimeType)) {
      add('media', `${label} does not accept ${item.mimeType} files.`)
      continue
    }

    const isVideo = limits.videoTypes.includes(item.mimeType)

    if (isVideo && limits.maxVideoMs && item.durationMs && item.durationMs > limits.maxVideoMs) {
      const minutes = Math.round(limits.maxVideoMs / 60_000)
      add('media', `${label} allows videos up to ${minutes} minutes.`)
    }

    // Dimensions are absent until the upload has been probed. Judging an
    // unmeasured file would block a perfectly good one, so it is skipped.
    if (!isVideo && limits.aspectRatio && item.width && item.height) {
      const ratio = item.width / item.height
      if (ratio < limits.aspectRatio.min || ratio > limits.aspectRatio.max) {
        add(
          'media',
          `${label} crops images outside 4:5 to 1.91:1. One of these is ${ratio.toFixed(2)}:1.`,
          // A warning, not an error: the platform accepts it and crops. The
          // user should know, but it is their picture and their decision.
          'warning',
        )
      }
    }
  }

  return issues
}

/** Validates against every platform this post is going to. */
export function validatePost(
  platforms: readonly Platform[],
  post: { caption: string; media: MediaItem[] },
): ValidationIssue[] {
  return [...new Set(platforms)].flatMap((platform) =>
    validateForPlatform(platform, post),
  )
}

export function blockingIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i) => i.severity === 'error')
}
