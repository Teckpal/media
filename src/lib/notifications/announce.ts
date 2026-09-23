import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Telling the workspace something happened.
 *
 * The audit log and this are not the same thing, and conflating them was the
 * gap: `recordAudit` writes a permanent trail for the question "who did that,
 * and when", asked weeks later by one admin. This writes the thing people
 * actually see — the bell, the panel, the toast — for the question "what is
 * going on", asked continuously by everyone.
 *
 * Most events want both. They stay separate calls because they answer to
 * different rules: the trail keeps everything, and a feed that keeps
 * everything is one nobody reads.
 *
 * ### Who it goes to
 *
 * `user_id: null`, which under `notifications_select_own` (migration 0008)
 * means every member of the workspace. Section 6.3 splits work across people,
 * so a post removed or an account disconnected is the team's business, not the
 * business of whoever happened to click. Something meant for one person takes
 * `userId` instead.
 *
 * ### The service role
 *
 * `notifications` has SELECT and UPDATE policies and no INSERT policy, so a
 * write through the request-scoped client is refused — silently, unless the
 * caller binds `error`. The same shape of bug that left `post.removed`
 * recorded nowhere. So the admin client writes, here, once.
 *
 * ### Failure
 *
 * Logged, never thrown. The thing being announced has already happened; an
 * invitation that succeeded must not report failure because the bell could
 * not be updated.
 */
export async function announce(event: {
  workspaceId: string
  /** Who did it, so their own action does not interrupt them with a toast. */
  actorId: string | null
  kind: string
  title: string
  body?: string | null
  /** Where tapping the notification goes. */
  linkPath?: string | null
  /** One person, rather than the whole workspace. Rare. */
  userId?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('notifications')
    .insert({
      workspace_id: event.workspaceId,
      user_id: event.userId ?? null,
      kind: event.kind,
      title: event.title,
      body: event.body ?? null,
      link_path: event.linkPath ?? null,
      // `actor_id` lives in `data` rather than in a column because nothing
      // queries by it — the browser only reads it to decide whether the person
      // looking at the screen is the one who caused this.
      data: { ...(event.detail ?? {}), actor_id: event.actorId } as never,
    })

  if (error) {
    console.error('[notify] could not announce %s: %s', event.kind, error.message)
  }
}

/**
 * How to name the person who did something, in a sentence about them.
 *
 * Falls back to the email, then to "Someone". An account can be deleted while
 * its notifications remain, and "Someone removed a post" is a true sentence
 * where a blank space is not.
 */
export function actorName(person: {
  full_name?: string | null
  email?: string | null
} | null): string {
  return person?.full_name?.trim() || person?.email || 'Someone'
}
