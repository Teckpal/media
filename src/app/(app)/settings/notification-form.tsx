'use client'

import { useActionState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { saveNotificationPreferencesAction } from '@/lib/notifications/actions'
import { EMPTY_FORM_STATE } from '@/lib/forms'
import {
  CATEGORY_LABELS,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from '@/lib/notifications/kinds'

/**
 * Which categories arrive by email.
 *
 * In-app is not on this form. It is the app showing its own state rather than
 * something being sent to you, and there is no version of this product where
 * "do not tell me a post failed" is a setting worth offering.
 */
export function NotificationForm({
  values,
}: {
  values: Record<NotificationCategory, boolean>
}) {
  const [state, action, pending] = useActionState(
    saveNotificationPreferencesAction,
    EMPTY_FORM_STATE,
  )

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}

      <ul className="space-y-3">
        {NOTIFICATION_CATEGORIES.map((category) => (
          <li key={category}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name={`email_${category}`}
                defaultChecked={values[category]}
                className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span>
                <span className="block text-sm font-medium">
                  {CATEGORY_LABELS[category].title}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {CATEGORY_LABELS[category].description}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
