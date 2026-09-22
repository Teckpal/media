import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { PublishMedia } from '@/lib/platforms/types'

/**
 * The post's media, as URLs a platform can fetch.
 *
 * Meta does not accept an upload from us — it takes a URL and fetches the bytes
 * itself, from its own servers. The bucket is private (migration 0011), so each
 * attempt mints fresh signed links rather than storing any.
 *
 * The window is deliberately much longer than the request: an Instagram video
 * container is processed asynchronously, and Meta may come back for the file
 * minutes after the call that created the container returned. A link that
 * expired in between would fail the publish for no reason a user could act on.
 * An hour is long enough for that and short enough that a leaked link is not a
 * standing invitation.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60

export type MediaLoad =
  | { ok: true; media: PublishMedia[] }
  | { ok: false; reason: string }

export async function signPostMedia(
  workspaceId: string,
  mediaIds: readonly string[],
): Promise<MediaLoad> {
  if (mediaIds.length === 0) return { ok: true, media: [] }

  const admin = createAdminClient()

  const { data: rows } = await admin
    .from('post_media')
    .select('id, storage_path, mime_type, alt_text')
    .eq('workspace_id', workspaceId)
    .in('id', [...mediaIds])

  const byId = new Map((rows ?? []).map((r) => [r.id, r]))

  // A media row that has gone missing is not something a retry fixes, and
  // publishing a carousel with a hole in it is worse than not publishing.
  const missing = mediaIds.filter((id) => !byId.has(id))
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        missing.length === mediaIds.length
          ? 'The images for this post are no longer available.'
          : `${missing.length} of this post's files are no longer available.`,
    }
  }

  const ordered = mediaIds.map((id) => byId.get(id)!)

  const { data: signed, error } = await admin.storage
    .from('post-media')
    .createSignedUrls(
      ordered.map((r) => r.storage_path),
      SIGNED_URL_TTL_SECONDS,
    )

  if (error) {
    return { ok: false, reason: 'We could not prepare this post’s media.' }
  }

  const urlByPath = new Map((signed ?? []).map((s) => [s.path ?? '', s.signedUrl ?? null]))

  const media: PublishMedia[] = []

  for (const row of ordered) {
    const url = urlByPath.get(row.storage_path)
    if (!url) {
      return { ok: false, reason: 'We could not prepare this post’s media.' }
    }

    media.push({
      id: row.id,
      mimeType: row.mime_type,
      url,
      altText: row.alt_text,
    })
  }

  // Order is content: it is the sequence of a carousel, not a detail.
  return { ok: true, media }
}
