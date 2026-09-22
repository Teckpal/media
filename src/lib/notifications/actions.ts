'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/auth/session'
import { NOTIFICATION_CATEGORIES, EMAIL_PREFERENCE_COLUMN } from '@/lib/notifications/kinds'
import { ROUTES } from '@/lib/routes'
import type { FormState } from '@/lib/forms'

/**
 * Reading notifications, and deciding which of them arrive by email.
 *
 * Both are the signed-in user's own business, so both go through the
 * request-scoped client and are governed by RLS (migration 0014): you may
 * insert a read for yourself, for a notification you can see, and you may edit
 * your own preferences. Neither needs the service role, and neither gets it.
 */

async function requireUser() {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)
  return user
}

const readSchema = z.object({ notificationId: z.string().uuid() })

export async function markNotificationReadAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser()

  const parsed = readSchema.safeParse({ notificationId: formData.get('notificationId') })
  if (!parsed.success) return { error: 'Unknown notification.' }

  const supabase = await createClient()

  // Upsert rather than insert: clicking the same thing twice is not an error,
  // and the primary key would otherwise make it one.
  const { error } = await supabase
    .from('notification_reads')
    .upsert(
      { notification_id: parsed.data.notificationId, user_id: user.id },
      { onConflict: 'notification_id,user_id', ignoreDuplicates: true },
    )

  // The RLS policy refuses a notification this user cannot see, which is the
  // same answer as "there is no such notification" — and deliberately so.
  if (error) return { error: 'That notification could not be marked as read.' }

  revalidateNotificationViews()
  return { error: null }
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser()
  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  const supabase = await createClient()

  // RLS already narrows this to what the user may see, so the filter here is
  // about the workspace they are looking at rather than about permission.
  const { data: visible } = await supabase
    .from('notifications')
    .select('id')
    .eq('workspace_id', workspaceId)
    .limit(500)

  const ids = (visible ?? []).map((row) => row.id)
  if (ids.length === 0) return

  const { data: alreadyRead } = await supabase
    .from('notification_reads')
    .select('notification_id')
    .in('notification_id', ids)

  const read = new Set((alreadyRead ?? []).map((row) => row.notification_id))
  const missing = ids.filter((id) => !read.has(id))

  if (missing.length > 0) {
    await supabase
      .from('notification_reads')
      .insert(missing.map((id) => ({ notification_id: id, user_id: user.id })))
  }

  revalidateNotificationViews()
}

/**
 * The list *and* the bell.
 *
 * The unread count is rendered by the `(app)` layout, not by the notifications
 * page, so revalidating the page alone would leave the number in the header
 * stale until the next navigation — the one thing a person is looking at when
 * they press "mark all as read".
 */
function revalidateNotificationViews(): void {
  revalidatePath('/', 'layout')
}

/**
 * Email preferences.
 *
 * In-app is not on this form, and that is the point: it is the app showing its
 * own state, not something being sent to you. Turning email off should never
 * mean finding out a week later that a post failed.
 */
export async function saveNotificationPreferencesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser()

  // An unchecked box posts nothing at all, so absence is what "off" looks
  // like. Every category is read explicitly rather than iterating the form,
  // so a field that is missing cannot leave an old value in place.
  const row: Record<string, unknown> = { user_id: user.id }

  for (const category of NOTIFICATION_CATEGORIES) {
    row[EMAIL_PREFERENCE_COLUMN[category]] = formData.get(`email_${category}`) === 'on'
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(row as never, { onConflict: 'user_id' })

  if (error) return { error: 'Those settings could not be saved.' }

  revalidatePath(ROUTES.settings)
  return { error: null, notice: 'Saved.' }
}
