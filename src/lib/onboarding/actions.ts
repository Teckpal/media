'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/auth/session'
import { hasActiveConnection } from '@/lib/auth/gate'
import { ROUTES } from '@/lib/routes'
import { PUBLIC_MODULES, type Module } from '@/lib/constants'
import { furthest } from '@/lib/onboarding/steps'
import type { OnboardingStep } from '@/lib/constants'
import { fieldErrorsFrom, type FormState } from '@/lib/forms'

/**
 * Section 5. Every step advance goes through `advance`, which only ever moves
 * forward — so a double submit, a stale tab, or a back button cannot reset
 * someone's progress.
 *
 * Each action re-checks its own precondition on the server. Section 4: the UI
 * hides buttons, the server enforces.
 */
async function advance(userId: string, to: OnboardingStep): Promise<OnboardingStep> {
  const supabase = await createClient()

  const { data: current } = await supabase
    .from('users')
    .select('onboarding_step')
    .eq('id', userId)
    .single()

  const target = furthest(current?.onboarding_step ?? 'verify_email', to)
  if (target === current?.onboarding_step) return target

  await supabase
    .from('users')
    .update({
      onboarding_step: target,
      onboarding_completed_at: target === 'done' ? new Date().toISOString() : null,
    })
    .eq('id', userId)

  return target
}

// --- Choose module (Section 3) ----------------------------------------------

const moduleSchema = z.enum(['personal', 'business'] as const satisfies readonly Module[])

export async function chooseModuleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)
  if (!user.emailVerified) redirect(ROUTES.verifyEmail)

  const parsed = moduleSchema.safeParse(formData.get('module'))
  if (!parsed.success) {
    // Section 3: Self (MOTiF) is admin-assigned and never offered in public
    // signup, so it is not in the schema and a crafted POST cannot pick it.
    return { error: 'Choose Personal or Business to continue.' }
  }

  const supabase = await createClient()
  await supabase
    .from('users')
    .update({ active_module: parsed.data })
    .eq('id', user.id)

  await advance(user.id, 'setup')
  redirect(ROUTES.onboarding.setup)
}

// --- Step 1: setup (Section 4, S1) ------------------------------------------

const setupSchema = z.object({
  name: z.string().trim().min(1, 'Give this workspace a name.').max(120),
  timezone: z.string().trim().min(1).max(64),
  industry: z.string().trim().max(120).optional(),
  websiteUrl: z.union([z.string().trim().url(), z.literal('')]).optional(),
  description: z.string().trim().max(2000).optional(),
  targetAudience: z.string().trim().max(1000).optional(),
  brandVoice: z.string().trim().max(500).optional(),
})

export async function completeSetupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)
  if (!user.emailVerified) redirect(ROUTES.verifyEmail)

  const activeModule = user.profile.active_module
  if (!activeModule || !PUBLIC_MODULES.includes(activeModule)) {
    // No module picked yet, or someone landed here out of order.
    redirect(ROUTES.onboarding.chooseModule)
  }

  const parsed = setupSchema.safeParse({
    name: formData.get('name'),
    timezone: formData.get('timezone'),
    industry: formData.get('industry') ?? undefined,
    websiteUrl: formData.get('websiteUrl') ?? undefined,
    description: formData.get('description') ?? undefined,
    targetAudience: formData.get('targetAudience') ?? undefined,
    brandVoice: formData.get('brandVoice') ?? undefined,
  })

  if (!parsed.success) {
    return { error: 'Check the fields below.', fieldErrors: fieldErrorsFrom(parsed.error.issues) }
  }

  if (!isKnownTimezone(parsed.data.timezone)) {
    return { error: 'That timezone is not one we recognise.' }
  }

  const supabase = await createClient()
  const existingId = user.profile.active_workspace_id

  // Re-running setup edits the workspace rather than creating a second one.
  // Section 3 allows exactly one workspace for Personal and one brand for
  // Business, so a refreshed form must not multiply them.
  let workspaceId = existingId
  if (workspaceId) {
    const { error } = await supabase
      .from('workspaces')
      .update({ name: parsed.data.name, timezone: parsed.data.timezone })
      .eq('id', workspaceId)
    if (error) return { error: 'Could not save that. Try again.' }
  } else {
    const { data: created, error } = await supabase
      .from('workspaces')
      .insert({
        name: parsed.data.name,
        type: activeModule,
        owner_id: user.id,
        timezone: parsed.data.timezone,
      })
      .select('id')
      .single()

    if (error || !created) return { error: 'Could not create the workspace. Try again.' }
    workspaceId = created.id

    // The creator is its owner. Without this row the RLS helpers see no
    // membership and the workspace would be invisible to the person who just
    // made it.
    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({ workspace_id: workspaceId, user_id: user.id, role: 'owner' })

    if (memberError) return { error: 'Could not set you as the owner. Try again.' }

    await supabase
      .from('users')
      .update({ active_workspace_id: workspaceId })
      .eq('id', user.id)
  }

  // Section 10: profiles_setup "feeds AI". Written here so Step 3 and the
  // Phase 2 planner have something to work from.
  const { error: setupError } = await supabase.from('profiles_setup').upsert(
    {
      workspace_id: workspaceId,
      brand_name: parsed.data.name,
      industry: parsed.data.industry || null,
      website_url: parsed.data.websiteUrl || null,
      description: parsed.data.description || null,
      target_audience: parsed.data.targetAudience || null,
      brand_voice: parsed.data.brandVoice || null,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  )

  if (setupError) return { error: 'Could not save your brand details. Try again.' }

  await advance(user.id, 'connect')
  redirect(ROUTES.onboarding.connect)
}

// --- Step 2: connect (Section 5, rule 3 — no skip) --------------------------

export async function continueFromConnectAction(): Promise<FormState> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  // Rule 3: there is no skip. Not a disabled button — a server-side refusal,
  // so a crafted POST gets the same answer the UI gives.
  if (!(await hasActiveConnection(workspaceId))) {
    return { error: 'Connect at least one account before continuing.' }
  }

  await advance(user.id, 'first_draft')
  redirect(ROUTES.onboarding.firstDraft)
}

// --- Step 3: first draft (Section 5, rule 4 — soft, always a draft) ---------

const firstDraftSchema = z.object({
  caption: z.string().trim().max(5000),
})

export async function saveFirstDraftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  const parsed = firstDraftSchema.safeParse({ caption: formData.get('caption') })
  if (!parsed.success) {
    return { error: 'That caption is too long.' }
  }

  if (parsed.data.caption.length > 0) {
    const supabase = await createClient()
    // Rule 4: the output of this step is always a draft. No scheduled_at, no
    // targets, nothing that a queue could pick up.
    const { error } = await supabase.from('posts').insert({
      workspace_id: workspaceId,
      created_by: user.id,
      status: 'draft',
      caption: parsed.data.caption,
    })

    if (error) return { error: 'Could not save that draft. Try again.' }
  }

  await advance(user.id, 'paywall')
  redirect(ROUTES.onboarding.paywall)
}

/** Rule 4 says the step is soft, so moving on without writing anything is fine. */
export async function skipFirstDraftAction(): Promise<void> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  await advance(user.id, 'paywall')
  redirect(ROUTES.onboarding.paywall)
}

// --- Step 4: paywall (Section 5, rule 5) ------------------------------------

/**
 * "Pay later" finishes onboarding and drops the user into unpaid mode
 * (Section 5, rules 5 and 6).
 *
 * Nothing about publishing is unlocked by this. The publish gate is a separate,
 * server-side check on an active subscription (Section 4, gate 2) and it is
 * still shut — which is why finishing here is safe.
 */
export async function payLaterAction(): Promise<void> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  // Belt and braces: reaching 'done' means the router gate will let this user
  // at the dashboard, so the no-skip rule is re-checked here too.
  if (!(await hasActiveConnection(workspaceId))) {
    redirect(ROUTES.onboarding.connect)
  }

  await advance(user.id, 'done')
  revalidatePath(ROUTES.dashboard)
  redirect(ROUTES.dashboard)
}

// --- helpers -----------------------------------------------------------------

/**
 * Validates against the runtime's own IANA database rather than a hand-kept
 * list, so a zone the picker does not offer is still accepted if it is real.
 */
function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}
