import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { ComposerMedia } from '@/app/(app)/posts/media-uploader'
import type { TargetOption } from '@/app/(app)/posts/composer'
import type { Platform } from '@/lib/constants'

/**
 * Reads shared by the posts list, the composer and the calendar.
 *
 * Kept apart from the actions so a page never reaches for a mutation module,
 * and so the shapes the composer expects are built in exactly one place.
 */

/** Accounts a post may be aimed at. Includes unhealthy ones, labelled. */
export async function loadTargetOptions(workspaceId: string): Promise<TargetOption[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('social_accounts')
    .select('id, platform, display_name, external_username, status, paid_seat')
    .eq('workspace_id', workspaceId)
    .in('status', ['active', 'needs_reconnect'])
    .order('connected_at', { ascending: true })

  return (data ?? []).map((a) => ({
    id: a.id,
    platform: a.platform as Platform,
    name: a.display_name ?? a.external_username ?? 'Connected account',
    paidSeat: a.paid_seat,
    needsReconnect: a.status === 'needs_reconnect',
  }))
}

/**
 * Media rows with a fresh signed URL each.
 *
 * The bucket is private (migration 0011), so a preview needs signing on every
 * render rather than a stored link — a leaked object path should not be a
 * permanent view of a client's unpublished campaign.
 */
export async function loadComposerMedia(
  workspaceId: string,
  ids: string[],
): Promise<ComposerMedia[]> {
  if (ids.length === 0) return []

  const supabase = await createClient()

  const { data } = await supabase
    .from('post_media')
    .select('id, storage_path, mime_type, byte_size, width, height, duration_ms')
    .eq('workspace_id', workspaceId)
    .in('id', ids)

  const rows = data ?? []
  if (rows.length === 0) return []

  const { data: signed } = await supabase.storage
    .from('post-media')
    .createSignedUrls(rows.map((r) => r.storage_path), 60 * 60)

  const urlByPath = new Map(
    (signed ?? []).map((s) => [s.path ?? '', s.signedUrl ?? null]),
  )

  const byId = new Map(rows.map((r) => [r.id, r]))

  // Ordered as the user arranged them; order is part of a carousel's content.
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      mimeType: r.mime_type,
      byteSize: r.byte_size,
      width: r.width,
      height: r.height,
      durationMs: r.duration_ms,
      previewUrl: urlByPath.get(r.storage_path) ?? null,
    }))
}
