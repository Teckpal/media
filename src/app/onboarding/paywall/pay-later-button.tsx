'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { payLaterAction } from '@/lib/onboarding/actions'

/**
 * Section 5, rule 5: "Pay later" is allowed, and lands the user in unpaid mode.
 *
 * It unlocks nothing. Publishing is behind a separate server-side check on an
 * active subscription (Section 4, gate 2), which is exactly why finishing
 * onboarding without paying is safe.
 */
export function PayLaterButton() {
  const [, action, pending] = useActionState(async () => {
    await payLaterAction()
  }, null)

  return (
    <form action={action}>
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? 'One moment…' : 'I will decide later'}
      </Button>
    </form>
  )
}
