import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  categoryOf,
  EMAIL_PREFERENCE_COLUMN,
  minimumRoleFor,
  type NotificationCategory,
} from '@/lib/notifications/kinds'
import { atLeast, type Role } from '@/lib/constants'
import type { WorkspaceRoleEnum } from '@/types/database'

/**
 * Who should be emailed about this, and who has asked not to be.
 *
 * Two filters, deliberately separate:
 *
 *   - **Eligibility** is about the workspace. A notification goes to people who
 *     could do something about it (`minimumRoleFor`), which is why a renewal
 *     reminder stops at the owner — Section 6.3 gives nobody else the ability
 *     to pay it.
 *   - **Preference** is about the person. Having decided who could act, we then
 *     honour anyone who has turned that category's emails off.
 *
 * In-app is not subject to either: the notification row exists and the app
 * shows it. Turning off email does not mean being kept in the dark.
 */

export type Recipient = {
  userId: string
  email: string
  name: string | null
}

export type Audience = {
  recipients: Recipient[]
  category: NotificationCategory
  /** Why nobody is getting this, when nobody is. */
  skipReason: string | null
}

export async function resolveEmailAudience(notification: {
  id: string
  workspace_id: string
  user_id: string | null
  kind: string
}): Promise<Audience> {
  const admin = createAdminClient()
  const category = categoryOf(notification.kind)

  const { data: members } = await admin
    .from('workspace_members')
    .select('user_id, role, users(id, email, full_name)')
    .eq('workspace_id', notification.workspace_id)
    .returns<
      {
        user_id: string
        role: WorkspaceRoleEnum
        users: { id: string; email: string; full_name: string | null } | null
      }[]
    >()

  const everyone = members ?? []

  // Addressed to one person. Still filtered through membership: someone
  // removed from the workspace (Section 6.3) should stop hearing about its
  // posts, and a notification written before they left must not outlive that.
  const eligible = notification.user_id
    ? everyone.filter((member) => member.user_id === notification.user_id)
    : everyone.filter((member) => atLeast(member.role as Role, minimumRoleFor(category)))

  if (eligible.length === 0) {
    return {
      recipients: [],
      category,
      skipReason: notification.user_id
        ? 'The person it was addressed to is no longer a member.'
        : `Nobody in this workspace holds the ${minimumRoleFor(category)} role.`,
    }
  }

  const preferenceColumn = EMAIL_PREFERENCE_COLUMN[category]

  const { data: preferences } = await admin
    .from('notification_preferences')
    .select('*')
    .in(
      'user_id',
      eligible.map((member) => member.user_id),
    )

  const byUser = new Map((preferences ?? []).map((row) => [row.user_id, row]))

  const recipients: Recipient[] = []

  for (const member of eligible) {
    if (!member.users?.email) continue

    // No row means no preference expressed, and the default is on. Section 11
    // wants people told; opting out is a choice someone has to make, not a
    // state they can end up in by never visiting Settings.
    const row = byUser.get(member.user_id) as Record<string, unknown> | undefined
    if (row && row[preferenceColumn] === false) continue

    recipients.push({
      userId: member.user_id,
      email: member.users.email,
      name: member.users.full_name,
    })
  }

  return {
    recipients,
    category,
    skipReason:
      recipients.length === 0
        ? 'Everyone who could act on this has turned these emails off.'
        : null,
  }
}
