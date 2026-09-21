'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { continueFromConnectAction } from '@/lib/onboarding/actions'
import { EMPTY_FORM_STATE, type FormState } from '@/lib/forms'

/**
 * Section 5, rule 3: Step 2 has no skip.
 *
 * The button is disabled when there is nothing connected, but that is only
 * politeness. The action re-checks on the server, so a crafted POST or a
 * re-enabled button in devtools gets the same refusal.
 */
export function ContinueButton({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<FormState>(
    async () => continueFromConnectAction(),
    EMPTY_FORM_STATE,
  )

  return (
    <div className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <form action={action}>
        <Button type="submit" size="lg" disabled={pending || !enabled}>
          {pending ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    </div>
  )
}
