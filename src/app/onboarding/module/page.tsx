import type { Metadata } from 'next'
import { ModuleChoice } from './module-choice'
import { requireVerifiedUser, guardOnboardingStep } from '@/lib/auth/gate'
import { STEP_ORDER } from '@/lib/onboarding/steps'

export const metadata: Metadata = { title: 'Choose how you post' }

export default async function ChooseModulePage() {
  const user = await requireVerifiedUser()
  guardOnboardingStep(user, 'choose_module', STEP_ORDER)

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">How will you use this?</h1>
        <p className="text-sm text-muted-foreground">
          You can switch later from Settings. Switching mid-cycle is pro-rated.
        </p>
      </div>

      <ModuleChoice initial={user.profile.active_module} />
    </div>
  )
}
