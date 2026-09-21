import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ONBOARDING_ROUTE, ROUTES } from '@/lib/routes'
import {
  getActiveWorkspace,
  getSessionUser,
  type ActiveWorkspace,
  type SessionUser,
} from '@/lib/auth/session'

/**
 * Gate 1 of the two in Section 4.
 *
 *   "Nobody reaches the dashboard without verified email, finished onboarding,
 *    and >= 1 active connection."
 *
 * Checked on the server, every time. It lives here rather than in the proxy
 * because a proxy can be routed around; a check that runs inside the page's own
 * render cannot be.
 */

export type GateVerdict =
  | { kind: 'signed_out'; redirectTo: string }
  | { kind: 'email_unverified'; redirectTo: string; user: SessionUser }
  | { kind: 'onboarding_incomplete'; redirectTo: string; user: SessionUser }
  | { kind: 'no_active_connection'; redirectTo: string; user: SessionUser }
  | { kind: 'ok'; user: SessionUser; active: ActiveWorkspace }

export async function evaluateGate(): Promise<GateVerdict> {
  const user = await getSessionUser()
  if (!user) {
    return { kind: 'signed_out', redirectTo: ROUTES.login }
  }

  // Section 5, rule 2: email is verified before OAuth, so this comes first.
  if (!user.emailVerified) {
    return { kind: 'email_unverified', redirectTo: ROUTES.verifyEmail, user }
  }

  const step = user.profile.onboarding_step
  if (step !== 'done') {
    // Section 5, rule 1: resume exactly where they left.
    return { kind: 'onboarding_incomplete', redirectTo: ONBOARDING_ROUTE[step], user }
  }

  const active = await getActiveWorkspace(user)
  if (!active) {
    // Onboarding says finished but there is no workspace to show — the profile
    // and the membership have drifted, or the user was removed from the
    // workspace they had pinned. Send them back to pick up the setup step
    // rather than rendering an empty dashboard.
    return {
      kind: 'onboarding_incomplete',
      redirectTo: ONBOARDING_ROUTE.setup,
      user,
    }
  }

  if (!(await hasActiveConnection(active.workspace.id))) {
    // Section 6.1: a revoked or expired connection drops the workspace here.
    // Drafts and data are kept; only the way forward is blocked.
    return { kind: 'no_active_connection', redirectTo: ROUTES.reconnect, user }
  }

  return { kind: 'ok', user, active }
}

/**
 * Section 6.1, "Last account disconnected": scheduling is locked.
 *
 * `needs_reconnect` deliberately does not count. A connection whose token has
 * expired cannot publish, so treating it as active would let a user past the
 * gate and into a calendar that silently fails.
 */
export async function hasActiveConnection(workspaceId: string): Promise<boolean> {
  const supabase = await createClient()

  const { count } = await supabase
    .from('social_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')

  return (count ?? 0) > 0
}

/**
 * The full gate: passes, or redirects and never returns.
 *
 * For the dashboard and everything that assumes a working workspace — posts,
 * the calendar, the planner.
 */
export async function requireDashboard(): Promise<{
  user: SessionUser
  active: ActiveWorkspace
}> {
  const verdict = await evaluateGate()
  if (verdict.kind !== 'ok') redirect(verdict.redirectTo)
  return { user: verdict.user, active: verdict.active }
}

/**
 * The gate without the connection requirement.
 *
 * Section 4 blocks the *dashboard* on having a live connection — not the whole
 * application. Connections, Billing and Settings have to stay reachable in
 * exactly the state that fails that check, or the reconnect screen would link
 * into a loop and an unpaid workspace could never reach checkout.
 *
 * Everything earlier in the order still applies: signed in, verified, finished
 * onboarding, member of a workspace.
 */
export async function requireWorkspace(): Promise<{
  user: SessionUser
  active: ActiveWorkspace
}> {
  const verdict = await evaluateGate()

  if (verdict.kind === 'ok') {
    return { user: verdict.user, active: verdict.active }
  }

  if (verdict.kind !== 'no_active_connection') {
    redirect(verdict.redirectTo)
  }

  // Past every other check; only the connection is missing. Resolve the
  // workspace directly, since `evaluateGate` stopped short of returning it.
  const active = await getActiveWorkspace(verdict.user)
  if (!active) redirect(ONBOARDING_ROUTE.setup)

  return { user: verdict.user, active }
}

/**
 * For pages that sit *inside* onboarding: a signed-in, email-verified user is
 * all that is required, because the point of those pages is that onboarding is
 * not finished yet.
 */
export async function requireVerifiedUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)
  if (!user.emailVerified) redirect(ROUTES.verifyEmail)
  return user
}

/**
 * Guards an onboarding page against being opened out of order.
 *
 * Going back to a finished step is fine — the note asks for resume, and a user
 * re-reading their own setup is harmless. Skipping ahead is not: Section 5,
 * rule 3 says Step 2 has no skip.
 */
export function guardOnboardingStep(
  user: SessionUser,
  page: keyof typeof ONBOARDING_ROUTE,
  order: readonly (keyof typeof ONBOARDING_ROUTE)[],
): void {
  const current = user.profile.onboarding_step
  if (current === 'done') return

  if (order.indexOf(page) > order.indexOf(current)) {
    redirect(ONBOARDING_ROUTE[current])
  }
}
