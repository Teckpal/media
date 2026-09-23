import { createClient } from '@/lib/supabase/server'
import { NotificationCentre } from './notification-centre'

/**
 * The notification bell in the header of every signed-in page.
 *
 * A thin server component wrapping a client one, which is the point: the
 * unread count is read on the server so the badge is correct in the first
 * paint rather than appearing a beat later, and everything that has to react
 * to a live event — the panel, the toast, the chime — happens in the browser.
 *
 * The count comes from `unread_notification_count` (migration 0014), an
 * anti-join PostgREST cannot express and one round trip rather than fetching
 * every notification and every read to subtract them here.
 *
 * `error` is bound deliberately. A failed count and a count of zero look
 * identical once the error is discarded, and a bell that quietly stops
 * counting is the failure nobody notices. On failure the badge starts at zero
 * and the client's own read corrects it a moment later.
 */
export async function NotificationBell({
  workspaceId,
  userId,
}: {
  workspaceId: string
  userId: string
}) {
  const supabase = await createClient()

  const { data: unread, error } = await supabase.rpc('unread_notification_count', {
    ws: workspaceId,
  })

  if (error) {
    console.error('[notifications] unread count failed', error)
  }

  return (
    <NotificationCentre
      workspaceId={workspaceId}
      userId={userId}
      initialUnread={error ? 0 : (unread ?? 0)}
    />
  )
}
