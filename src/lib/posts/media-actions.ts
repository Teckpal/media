'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/auth/session'
import { atLeast } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import type { WorkspaceRoleEnum } from '@/types/database'

/**
 * Media registration.
 *
 * The bytes go straight from the browser to Supabase Storage — they never pass
 * through a server action, which would mean holding a 200MB video in memory in
 * a serverless function. Storage RLS (migration 0011) decides who may write,
 * using the workspace id in the object key.
 *
 * What comes back here is only the metadata, and every part of it is re-derived
 * or re-checked rather than trusted: the object is confirmed to exist in this
 * workspace's prefix before a row is written.
 */

const registerSchema = z.object({
  storagePath: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(100),
  byteSize: z.number().int().positive().max(209_715_200),
  // Measured by the browser. Only ever used to warn about aspect ratio, so a
  // wrong value cannot do worse than show an unnecessary hint.
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  durationMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
  altText: z.string().trim().max(1000).optional(),
})

export type RegisterMediaInput = z.infer<typeof registerSchema>

export type RegisteredMedia = {
  id: string
  storagePath: string
  mimeType: string
  width: number | null
  height: number | null
  durationMs: number | null
  /** Signed, short-lived, for the composer preview. */
  previewUrl: string | null
}

export async function registerMediaAction(
  input: RegisterMediaInput,
): Promise<{ ok: true; media: RegisteredMedia } | { ok: false; error: string }> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  const supabase = await createClient()
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle<{ role: WorkspaceRoleEnum }>()

  if (!membership || !atLeast(membership.role, 'editor')) {
    return { ok: false, error: 'You do not have permission to add media.' }
  }

  const parsed = registerSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'That file could not be accepted.' }
  }

  // The key must sit under this workspace's own prefix. Storage RLS already
  // enforces it on the upload; repeating it here stops a row being registered
  // against an object the caller did not write.
  if (!parsed.data.storagePath.startsWith(`${workspaceId}/`)) {
    return { ok: false, error: 'That file does not belong to this workspace.' }
  }

  // Confirm the object is really there. Without this, a client could register
  // metadata for a file it never uploaded and the validator would pass a post
  // that has nothing to publish.
  const prefix = parsed.data.storagePath.slice(0, parsed.data.storagePath.lastIndexOf('/'))
  const filename = parsed.data.storagePath.slice(prefix.length + 1)

  const { data: listed } = await supabase.storage
    .from('post-media')
    .list(prefix, { search: filename, limit: 1 })

  if (!listed?.some((o) => o.name === filename)) {
    return { ok: false, error: 'That upload did not finish. Try again.' }
  }

  const { data: media, error } = await supabase
    .from('post_media')
    .insert({
      workspace_id: workspaceId,
      storage_path: parsed.data.storagePath,
      mime_type: parsed.data.mimeType,
      byte_size: parsed.data.byteSize,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
      duration_ms: parsed.data.durationMs ?? null,
      alt_text: parsed.data.altText || null,
      uploaded_by: user.id,
    })
    .select('id, storage_path, mime_type, width, height, duration_ms')
    .single()

  if (error || !media) {
    return { ok: false, error: 'Could not save that file. Try again.' }
  }

  const { data: signed } = await supabase.storage
    .from('post-media')
    .createSignedUrl(media.storage_path, 60 * 60)

  return {
    ok: true,
    media: {
      id: media.id,
      storagePath: media.storage_path,
      mimeType: media.mime_type,
      width: media.width,
      height: media.height,
      durationMs: media.duration_ms,
      previewUrl: signed?.signedUrl ?? null,
    },
  }
}
