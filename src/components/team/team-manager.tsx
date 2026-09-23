'use client'

import { useActionState } from 'react'
import { Mail, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
} from '@/lib/team/actions'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { buttonStyles } from '@/components/ui/button'
import { ROLES, atLeast, type Role } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { FormState } from '@/lib/forms'
import type { WorkspaceRoleEnum } from '@/types/database'

/**
 * Section 6.3's four roles, said in the words a person would use.
 *
 * Printed next to each choice rather than hidden behind a help link, because
 * the whole cost of getting this wrong is somebody picking "admin" when they
 * meant "editor" and only finding out when a client's post goes missing.
 */
const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including billing and deleting the workspace.',
  admin: 'Everything except billing and deletion.',
  editor: 'Writes and schedules posts. Cannot change the team.',
  viewer: 'Reads only.',
}

export type TeamMember = {
  userId: string
  role: WorkspaceRoleEnum
  name: string | null
  email: string
  isYou: boolean
}

export type PendingInvite = {
  id: string
  email: string
  role: WorkspaceRoleEnum
  expiresAt: string
}

const EMPTY: FormState = { error: null }

export function TeamManager({
  members,
  invites,
  actorRole,
  canManage,
}: {
  members: TeamMember[]
  invites: PendingInvite[]
  actorRole: WorkspaceRoleEnum
  canManage: boolean
}) {
  const [inviteState, invite, inviting] = useActionState(inviteMemberAction, EMPTY)
  const [roleState, changeRole] = useActionState(changeRoleAction, EMPTY)
  const [removeState, removeMember] = useActionState(removeMemberAction, EMPTY)
  const [revokeState, revokeInvite] = useActionState(revokeInviteAction, EMPTY)

  /** Nobody may hand out a role above their own; the server refuses it too. */
  const grantable = ROLES.filter((role) => atLeast(actorRole as Role, role))
  const owners = members.filter((member) => member.role === 'owner').length

  const notice = [inviteState, roleState, removeState, revokeState].find((s) => s.notice)?.notice
  const error = [inviteState, roleState, removeState, revokeState].find((s) => s.error)?.error

  return (
    <div className="space-y-6">
      {notice ? (
        <div
          role="status"
          className="rounded-[var(--radius)] border border-success/40 bg-success-subtle px-4 py-3 text-sm break-words"
        >
          {notice}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-danger/40 bg-danger-subtle px-4 py-2.5 text-sm"
        >
          {error}
        </p>
      ) : null}

      {/* --- who is here --- */}
      <Card className="p-0">
        <div className="border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-medium">
            {members.length} {members.length === 1 ? 'person' : 'people'}
          </h2>
        </div>

        <ul className="divide-y divide-border">
          {members.map((member) => {
            // An owner is re-ranked or removed only by another owner, and the
            // last one by nobody at all (`guard_last_owner` backs this up).
            const locked =
              !canManage ||
              (member.role === 'owner' && actorRole !== 'owner') ||
              (member.role === 'owner' && owners === 1)

            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {member.name ?? member.email}
                    {member.isYou ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">you</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>

                <div className="flex items-center gap-2">
                  {locked ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2.5 py-1 text-xs capitalize',
                        member.role === 'owner' && 'text-foreground',
                      )}
                    >
                      {member.role === 'owner' ? (
                        <ShieldCheck className="size-3.5" aria-hidden />
                      ) : null}
                      {member.role}
                    </span>
                  ) : (
                    <form action={changeRole} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={member.userId} />
                      <Select
                        name="role"
                        defaultValue={member.role}
                        aria-label={`Role for ${member.email}`}
                        onChange={(event) => event.currentTarget.form?.requestSubmit()}
                        className="h-9 text-sm capitalize"
                      >
                        {grantable.map((role) => (
                          <option key={role} value={role} className="capitalize">
                            {role}
                          </option>
                        ))}
                      </Select>
                    </form>
                  )}

                  {canManage && !locked ? (
                    <form action={removeMember}>
                      <input type="hidden" name="userId" value={member.userId} />
                      <button
                        type="submit"
                        aria-label={`Remove ${member.email}`}
                        className="rounded-[var(--radius)] p-2 text-muted-foreground transition-colors hover:bg-danger-subtle hover:text-foreground"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      {/* --- invitations waiting --- */}
      {canManage && invites.length > 0 ? (
        <Card className="p-0">
          <div className="border-b border-border px-5 py-3.5">
            <h2 className="text-sm font-medium">Invitations waiting</h2>
          </div>

          <ul className="divide-y divide-border">
            {invites.map((pending) => (
              <li
                key={pending.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{pending.email}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="capitalize">{pending.role}</span> · expires{' '}
                    {new Date(pending.expiresAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                </div>

                <form action={revokeInvite}>
                  <input type="hidden" name="inviteId" value={pending.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius)] px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* --- invite somebody --- */}
      {canManage ? (
        <Card className="space-y-4">
          <div>
            <h2 className="text-sm font-medium">Invite somebody</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              They need a motif Social account already — ask them to sign up
              first. The link then works once, only for that address, and
              expires in seven days.
            </p>
          </div>

          <form action={invite} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Field
                label="Email"
                htmlFor="invite-email"
                error={inviteState.fieldErrors?.email}
              >
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  placeholder="colleague@example.com"
                />
              </Field>
            </div>

            <div className="w-40">
              <Field label="Role" htmlFor="invite-role">
                <Select id="invite-role" name="role" defaultValue="editor" className="capitalize">
                  {grantable.map((role) => (
                    <option key={role} value={role} className="capitalize">
                      {role}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <button
              type="submit"
              disabled={inviting}
              className={buttonStyles({ className: 'mb-0.5 disabled:opacity-50' })}
            >
              <Mail className="size-4" aria-hidden />
              {inviting ? 'Creating…' : 'Create invitation'}
            </button>
          </form>

          <dl className="grid gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2">
            {grantable.map((role) => (
              <div key={role} className="flex gap-2">
                <dt className="font-medium capitalize text-foreground">{role}</dt>
                <dd>{ROLE_HELP[role]}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ) : null}
    </div>
  )
}
