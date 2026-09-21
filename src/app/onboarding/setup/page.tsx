import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SetupForm, type SetupDefaults } from './setup-form'
import { guardOnboardingStep, requireVerifiedUser } from '@/lib/auth/gate'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import { createClient } from '@/lib/supabase/server'
import { PUBLIC_MODULES } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Set up your workspace' }

const BLANK: SetupDefaults = {
  name: '',
  timezone: 'Asia/Dhaka',
  industry: '',
  websiteUrl: '',
  description: '',
  targetAudience: '',
  brandVoice: '',
}

export default async function SetupPage() {
  const user = await requireVerifiedUser()
  guardOnboardingStep(user, 'setup', STEP_ORDER)

  const module = user.profile.active_module
  if (!module || !PUBLIC_MODULES.includes(module)) {
    redirect(ROUTES.onboarding.chooseModule)
  }

  // Returning to a finished step shows what was saved, rather than a blank
  // form — that is what Section 5's "resume anywhere" should feel like.
  const workspaceId = user.profile.active_workspace_id
  let defaults = BLANK

  if (workspaceId) {
    const supabase = await createClient()
    const [{ data: workspace }, { data: setup }] = await Promise.all([
      supabase.from('workspaces').select('name, timezone').eq('id', workspaceId).maybeSingle(),
      supabase.from('profiles_setup').select('*').eq('workspace_id', workspaceId).maybeSingle(),
    ])

    defaults = {
      name: workspace?.name ?? '',
      timezone: workspace?.timezone ?? BLANK.timezone,
      industry: setup?.industry ?? '',
      websiteUrl: setup?.website_url ?? '',
      description: setup?.description ?? '',
      targetAudience: setup?.target_audience ?? '',
      brandVoice: setup?.brand_voice ?? '',
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {module === 'business' ? 'Tell us about the brand' : 'Set up your workspace'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Only the name and timezone are required. The rest sharpens what the AI
          Planner writes.
        </p>
      </div>

      <SetupForm module={module} defaults={defaults} editing={Boolean(workspaceId)} />
    </div>
  )
}
