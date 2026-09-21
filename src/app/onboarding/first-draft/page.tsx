import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { DraftForm } from './draft-form'
import { Alert } from '@/components/ui/alert'
import { guardOnboardingStep, requireVerifiedUser } from '@/lib/auth/gate'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Write your first post' }

/**
 * Step 3, and Section 5 rule 4 is the whole of it: soft, and the output is
 * always a draft.
 *
 * The AI Planner that will also live here is Phase 2. Its output is a draft
 * too — Section 6.2 is explicit that AI output never auto-publishes.
 */
export default async function FirstDraftPage() {
  const user = await requireVerifiedUser()
  guardOnboardingStep(user, 'first_draft', STEP_ORDER)

  if (!user.profile.active_workspace_id) redirect(ROUTES.onboarding.setup)

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Write your first post</h1>
        <p className="text-sm text-muted-foreground">
          Or skip it. Either way, nothing goes out until you say so.
        </p>
      </div>

      <Alert>
        Whatever you write here is saved as a draft. Scheduling and publishing
        come after you pick a plan.
      </Alert>

      <DraftForm />
    </div>
  )
}
