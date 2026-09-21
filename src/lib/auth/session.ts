import 'server-only'

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { UserRow, WorkspaceRow, WorkspaceRoleEnum } from '@/types/database'

export type SessionUser = {
  id: string
  email: string
  /** From auth.users.email_confirmed_at — the only thing that proves it. */
  emailVerified: boolean
  profile: UserRow
}

/**
 * The signed-in user, or null.
 *
 * Wrapped in React's `cache` so the gate, the layout and a page can each ask
 * for it within one request and it is fetched once.
 *
 * Always `getUser()`, never `getSession()`: the session is read from a cookie
 * the browser controls, while `getUser()` verifies the JWT with Supabase.
 * Everything downstream is an authorisation decision, so it has to be the
 * verified one.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    // The auth row exists but the trigger-created profile does not yet. Treat
    // it as signed out rather than inventing a half-user; the next request,
    // after the trigger has run, sees the real thing.
    return null
  }

  return {
    id: user.id,
    email: user.email ?? profile.email,
    emailVerified: Boolean(user.email_confirmed_at),
    profile,
  }
})

export type ActiveWorkspace = {
  workspace: WorkspaceRow
  role: WorkspaceRoleEnum
}

/**
 * The user's active workspace and their role in it.
 *
 * Returns null when there is no active workspace, or when the user is no longer
 * a member of the one pinned on their profile — which is what a removed member
 * looks like (Section 6.3).
 */
export const getActiveWorkspace = cache(
  async (user: SessionUser): Promise<ActiveWorkspace | null> => {
    const workspaceId = user.profile.active_workspace_id
    if (!workspaceId) return null

    const supabase = await createClient()

    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role, workspaces(*)')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle<{ role: WorkspaceRoleEnum; workspaces: WorkspaceRow | null }>()

    if (!membership?.workspaces) return null

    return { workspace: membership.workspaces, role: membership.role }
  },
)
