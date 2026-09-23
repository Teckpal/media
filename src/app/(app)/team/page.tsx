import type { Metadata } from 'next'
import { Card } from '@/components/ui/card'
import { TeamManager } from '@/components/team/team-manager'
import { ActivityTable, type ActivityEntry } from '@/components/team/activity-table'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import { atLeast, type Role } from '@/lib/constants'
import type { WorkspaceRoleEnum } from '@/types/database'

export const metadata: Metadata = { title: 'Team' }

/**
 * Section 6.3: who is in this workspace, and what they may do.
 *
 * Everyone can see the list — knowing who else is here is not a privilege, and
 * a viewer who cannot tell who approved something has to ask in a chat thread,
 * which is the habit the audit log exists to replace. Changing it is an
 * admin's job, and the server refuses the rest whatever this page renders.
 */
export default async function TeamPage() {
  const { user, active } = await requireWorkspace()
  const canManage = atLeast(active.role as Role, 'admin')

  const supabase = await createClient()

  // `users!workspace_members_user_id_fkey`, not `users`. There are TWO foreign
  // keys from this table to `users` — the member and whoever invited them — so
  // an unqualified embed is ambiguous and PostgREST answers 300 PGRST201
  // rather than guessing. Unnamed, this page rendered "0 people" for a
  // workspace with an owner in it.
  const { data: members, error: membersError } = await supabase
    .from('workspace_members')
    .select('user_id, role, joined_at, users!workspace_members_user_id_fkey(email, full_name)')
    .eq('workspace_id', active.workspace.id)
    .order('joined_at', { ascending: true })
    .returns<
      {
        user_id: string
        role: WorkspaceRoleEnum
        joined_at: string
        users: { email: string; full_name: string | null } | null
      }[]
    >()

  // Only an admin has a policy that can read these at all, so an editor simply
  // gets nothing rather than an error.
  if (membersError) {
    // Bound and surfaced rather than collapsing to an empty list. An empty team
    // and an unreadable one look identical otherwise, and the first is a fact
    // while the second is a fault.
    throw new Error(`Could not read the team: ${membersError.message}`)
  }

  const { data: invites } = canManage
    ? await supabase
        .from('invites')
        .select('id, email, role, expires_at, created_at')
        .eq('workspace_id', active.workspace.id)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .returns<
          { id: string; email: string; role: WorkspaceRoleEnum; expires_at: string; created_at: string }[]
        >()
    : { data: [] }

  /**
   * The activity log, for admins.
   *
   * `audit_log_select_admin` is the only SELECT policy on the table, so an
   * editor asking for these rows would get an empty list rather than an error
   * — which reads on screen as "nothing has happened", a lie. So the query is
   * not made at all unless the reader is allowed the answer.
   *
   * `users(...)` unqualified is safe here: `audit_log` has exactly one foreign
   * key to `users` (`actor_id`), unlike `workspace_members` above.
   */
  const { data: activity, error: activityError } = canManage
    ? await supabase
        .from('audit_log')
        .select('id, action, entity_type, entity_id, source, detail, created_at, users(email, full_name)')
        .eq('workspace_id', active.workspace.id)
        .order('created_at', { ascending: false })
        .limit(50)
        .returns<
          {
            id: number
            action: string
            entity_type: string | null
            entity_id: string | null
            source: string
            detail: Record<string, unknown> | null
            created_at: string
            users: { email: string; full_name: string | null } | null
          }[]
        >()
    : { data: [], error: null }

  // Surfaced, not swallowed. A failed read and a quiet workspace render the
  // same empty table otherwise, and only one of them is true.
  if (activityError) {
    console.error('[team] could not read activity: %s', activityError.message)
  }

  const entries: ActivityEntry[] = (activity ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    actorName: row.users?.full_name ?? null,
    actorEmail: row.users?.email ?? null,
    entityType: row.entity_type,
    entityId: row.entity_id,
    source: row.source,
    detail: row.detail ?? {},
    createdAt: row.created_at,
  }))

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          Who can work in {active.workspace.name}, and what each of them may do.
        </p>
      </div>

      <TeamManager
        members={(members ?? []).map((member) => ({
          userId: member.user_id,
          role: member.role,
          name: member.users?.full_name ?? null,
          email: member.users?.email ?? 'Unknown',
          isYou: member.user_id === user.id,
        }))}
        invites={(invites ?? []).map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expires_at,
        }))}
        actorRole={active.role}
        canManage={canManage}
      />

      {!canManage ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Only an owner or admin can invite people or change roles.
          </p>
        </Card>
      ) : (
        <ActivityTable
          entries={entries}
          timeZone={active.workspace.timezone}
          unreadable={Boolean(activityError)}
        />
      )}
    </div>
  )
}
