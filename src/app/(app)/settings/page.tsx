import type { Metadata } from 'next'
import { NotificationForm } from './notification-form'
import { Card } from '@/components/ui/card'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import {
  EMAIL_PREFERENCE_COLUMN,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from '@/lib/notifications/kinds'

export const metadata: Metadata = { title: 'Settings' }

/**
 * Settings, starting with the part Module 8 needs.
 *
 * The rest of Section 3's settings — switching module, the workspace profile,
 * the WhatsApp number from Section 8 — arrive with the modules that own them.
 * This page exists now because the navigation has always linked to it and
 * because email preferences have to live somewhere a person can find them.
 */
export default async function SettingsPage() {
  const { user, active } = await requireWorkspace()
  const supabase = await createClient()

  const { data: preferences } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  // No row means nothing has been turned off. Defaulting to on is the whole
  // point: nobody should discover they missed a failed post because a setting
  // they never saw defaulted to silence.
  const values = Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [
      category,
      preferences
        ? (preferences as Record<string, unknown>)[EMAIL_PREFERENCE_COLUMN[category]] !== false
        : true,
    ]),
  ) as Record<NotificationCategory, boolean>

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          These apply to you, not to {active.workspace.name} — each member
          chooses their own.
        </p>
      </div>

      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">Email notifications</h2>
          <p className="text-sm text-muted-foreground">
            Everything still appears in the app. This is only about what also
            reaches your inbox at {user.email}.
          </p>
        </div>

        <NotificationForm values={values} />
      </Card>
    </div>
  )
}
