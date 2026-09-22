'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSessionUser } from '@/lib/auth/session'
import { startCheckout } from '@/lib/billing/checkout'
import { REGION_COOKIE, readRegionHint } from '@/lib/region'
import { ROUTES } from '@/lib/routes'
import type { FormState } from '@/lib/forms'
import type { BillingRegion } from '@/lib/constants'
import type { WorkspaceRoleEnum, WorkspaceRow } from '@/types/database'

/**
 * Section 6.3: "Admin: everything except billing and deletion."
 *
 * So every action here is the owner's. An admin can run the whole workspace
 * and still cannot spend its money, which is the distinction the note draws
 * and the one a customer would expect.
 */

type BillingActor = {
  userId: string
  name: string
  email: string
  workspace: Pick<WorkspaceRow, 'id' | 'name' | 'billing_region' | 'is_billing_exempt'>
  regionHint: BillingRegion
}

async function requireOwner(): Promise<BillingActor> {
  const user = await getSessionUser()
  if (!user) redirect(ROUTES.login)

  const workspaceId = user.profile.active_workspace_id
  if (!workspaceId) redirect(ROUTES.onboarding.setup)

  const supabase = await createClient()
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role, workspaces(id, name, billing_region, is_billing_exempt)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle<{
      role: WorkspaceRoleEnum
      workspaces: Pick<
        WorkspaceRow,
        'id' | 'name' | 'billing_region' | 'is_billing_exempt'
      > | null
    }>()

  if (!membership?.workspaces || membership.role !== 'owner') {
    redirect(`${ROUTES.billing}?error=owner_only`)
  }

  return {
    userId: user.id,
    name: user.profile.full_name ?? user.email ?? 'Customer',
    email: user.email ?? '',
    workspace: membership.workspaces,
    regionHint: readRegionHint(
      (await cookies()).get(REGION_COOKIE)?.value,
      user.profile.signup_country,
    ),
  }
}

const checkoutSchema = z.object({
  // A plan *code*, never a price. Section 7A.3: the server reads the amount
  // from `plans`, and there is no field here through which a browser could
  // suggest one.
  planCode: z.enum(['starter', 'growth', 'agency']),
})

export async function startCheckoutAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await requireOwner()

  const parsed = checkoutSchema.safeParse({ planCode: formData.get('planCode') })
  if (!parsed.success) return { error: 'Pick one of the packages.' }

  const outcome = await startCheckout({
    workspace: actor.workspace,
    actor: { id: actor.userId, name: actor.name, email: actor.email },
    planCode: parsed.data.planCode,
    regionHint: actor.regionHint,
  })

  if (outcome.kind === 'error') return { error: outcome.message }

  if (outcome.kind === 'activated') {
    revalidatePath(ROUTES.billing)
    // `redirect` throws, so it sits outside anything that might catch it.
    redirect(`${ROUTES.billing}?activated=1`)
  }

  // Off to the gateway. An absolute URL is fine here — `redirect` takes one,
  // and this is the one place in the app that deliberately leaves it.
  redirect(outcome.url)
}
