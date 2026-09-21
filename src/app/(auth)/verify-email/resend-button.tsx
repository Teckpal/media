'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { resendVerificationAction } from '@/lib/auth/actions'
import type { AuthFormState } from '@/lib/auth/form-state'

export function ResendButton() {
  const [state, action, pending] = useActionState<AuthFormState>(
    async () => resendVerificationAction(),
    { error: null },
  )

  return (
    <div className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.notice ? <Alert tone="success">{state.notice}</Alert> : null}

      <form action={action}>
        <Button type="submit" variant="secondary" fullWidth disabled={pending}>
          {pending ? 'Sending…' : 'Send the email again'}
        </Button>
      </form>
    </div>
  )
}
