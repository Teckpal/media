import type { Metadata } from 'next'
import Link from 'next/link'
import { MarkAllReadButton, MarkReadButton } from './read-buttons'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import { CATEGORY_LABELS, categoryOf } from '@/lib/notifications/kinds'
import { isInternalPath } from '@/lib/notifications/templates'
import { formatDateTimeInZone } from '@/lib/time'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Notifications' }

/**
 * Section 11: everything the workspace has been told, in one place.
 *
 * RLS decides what appears (migration 0008): your own notifications, plus the
 * workspace-wide ones if you are a member. Read state comes from
 * `notification_reads` rather than from the notification itself, because a
 * shared row is read by one person at a time.
 */
export default async function NotificationsPage() {
  const { active } = await requireWorkspace()
  const supabase = await createClient()

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, kind, title, body, link_path, created_at, user_id')
    .eq('workspace_id', active.workspace.id)
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = notifications ?? []

  const { data: reads } = await supabase
    .from('notification_reads')
    .select('notification_id')
    .in(
      'notification_id',
      rows.map((row) => row.id),
    )

  const read = new Set((reads ?? []).map((row) => row.notification_id))
  const unreadCount = rows.filter((row) => !read.has(row.id)).length

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0
              ? `${unreadCount} unread.`
              : 'Nothing new. Everything here is kept for your records.'}
          </p>
        </div>

        {unreadCount > 0 ? <MarkAllReadButton /> : null}
      </div>

      {rows.length === 0 ? (
        <Alert>
          Nothing yet. When a post goes out, an account needs reconnecting or an
          invoice is due, it will appear here — and by email, unless you have
          turned that off in{' '}
          <Link href={ROUTES.settings} className="text-primary hover:underline">
            Settings
          </Link>
          .
        </Alert>
      ) : (
        <ul className="space-y-2">
          {rows.map((notification) => {
            const isUnread = !read.has(notification.id)
            const category = categoryOf(notification.kind)

            return (
              <li key={notification.id}>
                <Card
                  className={
                    isUnread ? 'space-y-2 border-primary/30 p-4' : 'space-y-2 p-4 opacity-75'
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[category].title}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTimeInZone(
                        notification.created_at,
                        active.workspace.timezone,
                      )}
                    </span>
                    {notification.user_id === null ? (
                      <span className="text-xs text-muted-foreground">
                        · everyone in this workspace
                      </span>
                    ) : null}
                  </div>

                  <p className="text-sm font-medium">{notification.title}</p>

                  {notification.body ? (
                    <p className="text-sm text-muted-foreground">{notification.body}</p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    {/* The same rule the email uses: only a plain internal path
                        is linked, so a row can never become an off-site link. */}
                    {isInternalPath(notification.link_path) ? (
                      <Link
                        href={notification.link_path}
                        className="text-sm text-primary hover:underline"
                      >
                        Take a look
                      </Link>
                    ) : null}

                    {isUnread ? <MarkReadButton notificationId={notification.id} /> : null}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
