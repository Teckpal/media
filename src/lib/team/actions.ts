'use server'

import { randomBytes, createHash } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth/session'
import { atLeast, ROLES, ROLE_RANK, type Role } from '@/lib/constants'
import { recordAudit } from '@/lib/audit/record'
import { announce, actorName } from '@/lib/notifications/announce'
import { ROUTES } from '@/lib/routes'
import { fieldErrorsFrom, type FormState } from '@/lib/forms'
import type { WorkspaceRoleEnum } from '@/types/database'

/**
 * Section 6.3: the team, and who is allowed to change it.
 *
 * The rules that matter here are about privilege, and every one of them is
 * checked on the server whatever the buttons show:
 *
 * - Only an admin or owner touches membership at all.
 * - Nobody may hand out a role above their own. An admin inviting an owner
 *   would be a promotion they cannot otherwise perform, which is the ordinary
 *   shape of a privilege-escalation bug.
 * - Only an owner may change or remove another owner.
 * - The last owner cannot be removed. The database enforces this too
 *   (`guard_last_owner`); the check here exists so the answer is a sentence
 *   rather than a constraint violation.
 *
 * Invites are single-use, bound to one email address, and expire in seven
 * days. Only the SHA-256 of the token is stored: a leaked database row cannot
 * be redeemed, which is the same reason a password is not stored either.
 */

const INVITE_TTL_DAYS = 7

type Actor = {
  userId: string
  workspaceId: string
  role: WorkspaceRoleEnum
  /** For the sentence in the notification: "Rina invited ...". */
  name: string
}

async function requireAdmin(): Promise<Actor> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  const supabase = await createClient()
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle<{ role: WorkspaceRoleEnum }>()

  if (!membership || !atLeast(membership.role as Role, 'admin')) {
    redirect(ROUTES.team)
  }

  return {
    userId: user.id,
    workspaceId,
    role: membership.role,
    name: actorName({ full_name: user.profile.full_name, email: user.email }),
  }
}

/** The token the invitee carries; only its hash is ever stored. */
function mintToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: createHash('sha256').update(token).digest('hex') }
}

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// --- inviting ----------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('That does not look like an email address.'),
  role: z.enum(ROLES),
})

export async function inviteMemberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireAdmin()

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  })
  if (!parsed.success) {
    return { error: 'Check the fields below.', fieldErrors: fieldErrorsFrom(parsed.error.issues) }
  }

  const { email, role } = parsed.data

  // Nobody hands out a role above their own.
  if (!atLeast(actor.role as Role, role)) {
    return { error: `You cannot invite somebody as ${role}.` }
  }

  const supabase = await createClient()

  // Already in the workspace? Inviting them again would create a second
  // membership row the moment they accepted.
  // Named FK: `workspace_members` points at `users` twice (the member, and
  // whoever invited them), so an unqualified embed is ambiguous.
  const { data: existing, error: existingError } = await supabase
    .from('workspace_members')
    .select('user_id, users!workspace_members_user_id_fkey(email)')
    .eq('workspace_id', actor.workspaceId)
    .returns<{ user_id: string; users: { email: string } | null }[]>()

  // A failed read must not pass for "nobody is here" — that would let the same
  // person be invited twice over.
  if (existingError) return { error: 'Could not check the current team. Try again.' }

  if ((existing ?? []).some((member) => member.users?.email?.toLowerCase() === email)) {
    return { error: 'That person is already in this workspace.' }
  }

  /**
   * The address has to belong to an account that already exists.
   *
   * An invitation is a role on a workspace, and a role needs somebody to hold
   * it. Inviting a stranger meant minting a link, mailing it to an address
   * nobody had claimed, and waiting for whoever opened it to sign up — three
   * steps that can each go wrong, on a path where being wrong hands workspace
   * access to the wrong person.
   *
   * Asking for an existing account makes the invitation a lookup instead: the
   * person is already known, `acceptInvite` only has to match them, and the
   * address is one Supabase has already accepted.
   *
   * Through the service role deliberately. `users` is readable only within a
   * shared workspace, so the request-scoped client cannot see somebody this
   * workspace has never met — which is precisely everybody worth inviting.
   * Nothing about them is returned to the caller: the answer below is the
   * same sentence whether the address is unknown or merely unreadable.
   */
  const { data: account, error: accountError } = await createAdminClient()
    .from('users')
    .select('id')
    .ilike('email', email)
    .maybeSingle<{ id: string }>()

  if (accountError) return { error: 'Could not check that address. Try again.' }

  if (!account) {
    return {
      error: `${email} does not have a motif Social account yet. Ask them to sign up first, then invite them.`,
      fieldErrors: { email: 'No account with this address.' },
    }
  }

  // One live invite per address. A second would leave the first redeemable.
  await supabase
    .from('invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('workspace_id', actor.workspaceId)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null)

  const { token, hash } = mintToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

  const { error } = await supabase.from('invites').insert({
    workspace_id: actor.workspaceId,
    email,
    role,
    token_hash: hash,
    invited_by: actor.userId,
    expires_at: expiresAt.toISOString(),
  })

  if (error) return { error: 'Could not create that invitation.' }

  // The address, not the token. The trail says who was invited and by whom;
  // the token is a credential and belongs in no log.
  await recordAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: 'member.invited',
    entityType: 'invite',
    entityId: email,
    detail: { email, role },
  })

  await announce({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    kind: 'member_invited',
    title: `${actor.name} invited somebody to the workspace`,
    body: `${email}, as ${role}. They join once they open the link.`,
    linkPath: ROUTES.team,
    detail: { email, role },
  })

  revalidatePath(ROUTES.team)

  // The link is shown once, here. No email provider is configured yet, and a
  // link nobody receives is not an invitation — so it is handed to the person
  // who created it to pass on, rather than dropped into a queue that looks
  // like it worked.
  return {
    error: null,
    notice: `Invitation ready. Send them this link — it works once and expires in ${INVITE_TTL_DAYS} days: ${inviteUrl(token)}`,
  }
}

function inviteUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? ''
  return `${base}/invite/${token}`
}

// --- revoking ----------------------------------------------------------------

const idSchema = z.object({ id: z.string().uuid() })

export async function revokeInviteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireAdmin()

  const parsed = idSchema.safeParse({ id: formData.get('inviteId') })
  if (!parsed.success) return { error: 'Unknown invitation.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', parsed.data.id)
    .eq('workspace_id', actor.workspaceId)
    .is('accepted_at', null)

  if (error) return { error: 'Could not revoke that invitation.' }

  await recordAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: 'invite.revoked',
    entityType: 'invite',
    entityId: parsed.data.id,
  })

  await announce({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    kind: 'invite_revoked',
    title: `${actor.name} withdrew an invitation`,
    body: 'That link no longer works.',
    linkPath: ROUTES.team,
  })

  revalidatePath(ROUTES.team)
  return { error: null, notice: 'Invitation revoked. That link no longer works.' }
}

// --- roles and removal --------------------------------------------------------

/** A member being acted on, with enough to name them in a sentence. */
type TargetMember = {
  role: WorkspaceRoleEnum
  users: { email: string; full_name: string | null } | null
}

const memberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES).optional(),
})

export async function changeRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireAdmin()

  const parsed = memberSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  })
  if (!parsed.success || !parsed.data.role) return { error: 'Unknown member or role.' }

  const { userId, role } = parsed.data

  if (!atLeast(actor.role as Role, role)) {
    return { error: `You cannot make somebody ${role}.` }
  }

  const supabase = await createClient()

  // Named FK, as on the Team page: two foreign keys run from this table to
  // `users`, so an unqualified embed is ambiguous and answered with a 300.
  const { data: target } = await supabase
    .from('workspace_members')
    .select('role, users!workspace_members_user_id_fkey(email, full_name)')
    .eq('workspace_id', actor.workspaceId)
    .eq('user_id', userId)
    .maybeSingle<TargetMember>()

  if (!target) return { error: 'That person is not in this workspace.' }

  // Only an owner re-ranks an owner.
  if (target.role === 'owner' && actor.role !== 'owner') {
    return { error: 'Only an owner can change another owner.' }
  }

  const { error } = await supabase
    .from('workspace_members')
    .update({ role })
    .eq('workspace_id', actor.workspaceId)
    .eq('user_id', userId)

  if (error) {
    // `guard_last_owner` fires when this would demote the only owner.
    return { error: 'That would leave the workspace without an owner.' }
  }

  // Before and after both, because "made editor" only means something next to
  // what they were. A silent promotion to admin is the thing this exists for.
  await recordAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: 'member.role_changed',
    entityType: 'member',
    entityId: userId,
    detail: { from: target.role, to: role },
  })

  await announce({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    kind: 'member_role_changed',
    title: `${actorName(target.users)} is now ${role}`,
    body: `${actor.name} changed their role from ${target.role}.`,
    linkPath: ROUTES.team,
    detail: { member_id: userId, from: target.role, to: role },
  })

  revalidatePath(ROUTES.team)
  return { error: null, notice: 'Role updated.' }
}

export async function removeMemberAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireAdmin()

  const parsed = memberSchema.safeParse({ userId: formData.get('userId') })
  if (!parsed.success) return { error: 'Unknown member.' }

  const { userId } = parsed.data

  const supabase = await createClient()
  const { data: target } = await supabase
    .from('workspace_members')
    .select('role, users!workspace_members_user_id_fkey(email, full_name)')
    .eq('workspace_id', actor.workspaceId)
    .eq('user_id', userId)
    .maybeSingle<TargetMember>()

  if (!target) return { error: 'That person is not in this workspace.' }

  if (target.role === 'owner' && actor.role !== 'owner') {
    return { error: 'Only an owner can remove another owner.' }
  }

  const { error } = await supabase
    .from('workspace_members')
    .delete()
    .eq('workspace_id', actor.workspaceId)
    .eq('user_id', userId)

  if (error) {
    return { error: 'That would leave the workspace without an owner.' }
  }

  // Section 6.3: their posts stay with the workspace. Only the membership goes.
  // If this was their active workspace, clear the pin so the router gate sends
  // them somewhere that exists rather than to a dashboard they cannot read.
  await createAdminClient()
    .from('users')
    .update({ active_workspace_id: null })
    .eq('id', userId)
    .eq('active_workspace_id', actor.workspaceId)

  await recordAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: 'member.removed',
    entityType: 'member',
    entityId: userId,
    detail: { role: target.role },
  })

  await announce({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    kind: 'member_removed',
    title: `${actorName(target.users)} was removed from the workspace`,
    body: `${actor.name} removed them. Their posts stay with the workspace.`,
    linkPath: ROUTES.team,
    detail: { member_id: userId, role: target.role },
  })

  revalidatePath(ROUTES.team)
  return { error: null, notice: 'Removed. Their posts stay with the workspace.' }
}

// --- accepting ----------------------------------------------------------------

/**
 * Redeems an invite for the signed-in user.
 *
 * Runs with the service role on purpose: the invitee is not a member yet, so
 * no RLS policy could let them read the row that is about to admit them. Every
 * condition is therefore checked here, explicitly.
 */
export async function acceptInvite(
  token: string,
  user: { id: string; email: string },
): Promise<{ ok: true; workspaceId: string } | { ok: false; reason: string }> {
  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('invites')
    .select('id, workspace_id, email, role, expires_at, accepted_at, revoked_at')
    .eq('token_hash', hashOf(token))
    .maybeSingle<{
      id: string
      workspace_id: string
      email: string
      role: WorkspaceRoleEnum
      expires_at: string
      accepted_at: string | null
      revoked_at: string | null
    }>()

  if (!invite) return { ok: false, reason: 'This invitation link is not valid.' }
  if (invite.revoked_at) return { ok: false, reason: 'This invitation was revoked.' }
  if (invite.accepted_at) return { ok: false, reason: 'This invitation has already been used.' }
  if (new Date(invite.expires_at) < new Date()) {
    return { ok: false, reason: 'This invitation has expired. Ask for a new one.' }
  }

  // Bound to one address. Otherwise a forwarded link admits whoever opens it.
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return {
      ok: false,
      reason: `This invitation was sent to ${invite.email}. Sign in with that address to accept it.`,
    }
  }

  /**
   * Accepting an invitation never LOWERS an existing role.
   *
   * A plain upsert overwrote it, which turns an invitation into a demotion
   * tool: an admin cannot demote an owner through `changeRoleAction`, but
   * could invite them as a viewer and wait for the click. The creation path
   * refuses to invite an existing member, so this is defence behind that — but
   * the two checks race, one of them runs with the service role, and the cost
   * of being wrong is somebody losing control of their own workspace.
   */
  const { data: current } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', invite.workspace_id)
    .eq('user_id', user.id)
    .maybeSingle<{ role: WorkspaceRoleEnum }>()

  if (current) {
    const keepsExisting = ROLE_RANK[current.role as Role] >= ROLE_RANK[invite.role as Role]

    if (!keepsExisting) {
      const { error: promoteError } = await admin
        .from('workspace_members')
        .update({ role: invite.role })
        .eq('workspace_id', invite.workspace_id)
        .eq('user_id', user.id)

      if (promoteError) return { ok: false, reason: 'We could not update your access.' }
    }
  } else {
    const { error: memberError } = await admin.from('workspace_members').insert({
      workspace_id: invite.workspace_id,
      user_id: user.id,
      role: invite.role,
    })

    if (memberError) return { ok: false, reason: 'We could not add you to that workspace.' }
  }

  // Single-use: marked consumed only after the membership exists, so a failure
  // above leaves the invitation still redeemable rather than burning it.
  await admin
    .from('invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq('id', invite.id)

  /**
   * Section 4's invite branch: verify, join with a role, dashboard.
   *
   * An invited member does NOT walk onboarding. Choosing a module and filling
   * in a business profile are things the workspace already has — they were
   * done by whoever created it — so leaving `onboarding_step` alone strands
   * the new member on a setup screen for a workspace that is already set up.
   * That is what happened the first time this ran.
   *
   * The module is copied from the workspace rather than guessed, so the app
   * shows them the same shape of product as everybody else in it.
   */
  const { data: workspace } = await admin
    .from('workspaces')
    .select('type')
    .eq('id', invite.workspace_id)
    .maybeSingle<{ type: 'self' | 'personal' | 'business' }>()

  await admin
    .from('users')
    .update({
      active_workspace_id: invite.workspace_id,
      onboarding_step: 'done',
      onboarding_completed_at: new Date().toISOString(),
      active_module: workspace?.type ?? 'business',
    })
    .eq('id', user.id)

  await announce({
    workspaceId: invite.workspace_id,
    actorId: user.id,
    kind: 'member_joined',
    title: `${user.email} joined the workspace`,
    body: `They accepted an invitation as ${invite.role}.`,
    linkPath: ROUTES.team,
    detail: { member_id: user.id, role: invite.role },
  })

  // The actor is the person joining, not whoever invited them — this records
  // the acceptance, which is their action.
  await recordAudit({
    workspaceId: invite.workspace_id,
    actorId: user.id,
    action: 'member.joined',
    entityType: 'member',
    entityId: user.id,
    detail: { role: invite.role, via: 'invite' },
  })

  return { ok: true, workspaceId: invite.workspace_id }
}
