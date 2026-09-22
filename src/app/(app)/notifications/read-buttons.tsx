'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/lib/notifications/actions'
import { EMPTY_FORM_STATE } from '@/lib/forms'

/**
 * Marking things read.
 *
 * Plain forms rather than optimistic state: the read is a row in a table, and
 * a tick that appears before the row exists is a tick that can be wrong. The
 * round trip is short and the page revalidates.
 */
export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const [state, action, pending] = useActionState(
    markNotificationReadAction,
    EMPTY_FORM_STATE,
  )

  if (state.error) {
    return <span className="text-sm text-danger">{state.error}</span>
  }

  return (
    <form action={action}>
      <input type="hidden" name="notificationId" value={notificationId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? 'Marking…' : 'Mark as read'}
      </Button>
    </form>
  )
}

export function MarkAllReadButton() {
  const [, action, pending] = useActionState(async () => {
    await markAllNotificationsReadAction()
  }, null)

  return (
    <form action={action}>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'One moment…' : 'Mark all as read'}
      </Button>
    </form>
  )
}
