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
export function PayLaterButton({ label }: { label?: string }) {
  const [, action, pending] = useActionState(async () => {
    await payLaterAction()
  }, null)

  return (
    <form action={action}>
      {/* Under OPEN_ACCESS this is no longer an aside, so it stops looking
          like one. Same action, same server checks — only the wording and the
          weight change, because "I will decide later" is the wrong sentence
          when there is nothing to decide. */}
      <Button
        type="submit"
        variant={label ? 'primary' : 'ghost'}
        size={label ? 'lg' : 'sm'}
        disabled={pending}
      >
        {pending ? 'One moment…' : (label ?? 'I will decide later')}
      </Button>
    </form>
  )
}
