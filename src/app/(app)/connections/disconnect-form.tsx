'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { disconnectAccountAction } from '@/lib/connections/actions'
import { EMPTY_FORM_STATE } from '@/lib/forms'

/**
 * Section 6.1: disconnecting pauses what that account was going to publish and
 * frees the billing seat at the end of the cycle. Both consequences are said
 * out loud here, because neither is obvious and both are hard to notice after
 * the fact.
 *
 * Not a browser `confirm()`: a native dialog blocks and cannot be styled, and
 * the second click is a plain submit the server treats like any other.
 */
export function DisconnectForm({
  accountId,
  name,
}: {
  accountId: string
  name: string
}) {
  const [state, action, pending] = useActionState(
    disconnectAccountAction,
    EMPTY_FORM_STATE,
  )

  return (
    <div className="space-y-2">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}

      <form action={action}>
        <input type="hidden" name="accountId" value={accountId} />
        <Button type="submit" variant="ghost" size="sm" disabled={pending}>
          {pending ? 'Disconnecting…' : 'Disconnect'}
          <span className="sr-only"> {name}</span>
        </Button>
      </form>
    </div>
  )
}
