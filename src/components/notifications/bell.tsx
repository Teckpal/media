import Link from 'next/link'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/routes'

/**
 * The unread count, in the header of every signed-in page.
 *
 * A server component, so the number is right on arrival rather than appearing
 * a moment later. The count comes from `unread_notification_count` (migration
 * 0014) — an anti-join PostgREST cannot express, and one round trip rather
 * than fetching every notification and every read to subtract them here.
 *
 * Above 9 it says "9+". The exact number stops being useful long before it
 * stops fitting.
 */
export async function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const supabase = await createClient()

  const { data: unread } = await supabase.rpc('unread_notification_count', {
    ws: workspaceId,
  })

  const count = unread ?? 0

  return (
    <Link
      href={ROUTES.notifications}
      aria-label={
        count > 0 ? `Notifications, ${count} unread` : 'Notifications, none unread'
      }
      className="relative inline-flex size-9 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
    >
      <Bell className="size-4" aria-hidden />

      {count > 0 ? (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground"
        >
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  )
}
