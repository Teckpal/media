import { redirect } from 'next/navigation'
import { Wordmark } from '@/components/brand/wordmark'
import { Stepper } from '@/components/onboarding/stepper'
import { Button } from '@/components/ui/button'
import { requireVerifiedUser } from '@/lib/auth/gate'
import { signOutAction } from '@/lib/auth/actions'
import { ROUTES } from '@/lib/routes'

/**
 * Onboarding sits outside the `(app)` group, because the gate on that group is
 * exactly what sends people here. What it does require is Section 5, rule 2: a
 * verified email, before any OAuth.
 *
 * Each page then guards its own position in the order, so a user cannot type
 * their way to a later step.
 */
export default async function OnboardingLayout({ children }: LayoutProps<'/'>) {
  const user = await requireVerifiedUser()

  // Nothing left to do here.
  if (user.profile.onboarding_step === 'done') redirect(ROUTES.dashboard)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-8">
        <Wordmark />
        <form action={signOutAction}>
          {/* Section 5, rule 3: no skip, but "save and exit" is always there.
              Progress is already saved on the user row, so leaving loses
              nothing. */}
          <Button type="submit" variant="ghost" size="sm">
            Save and exit
          </Button>
        </form>
      </header>

      <div className="border-b border-border px-4 py-4 sm:px-8">
        <Stepper current={user.profile.onboarding_step} />
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-8">{children}</main>
    </div>
  )
}
