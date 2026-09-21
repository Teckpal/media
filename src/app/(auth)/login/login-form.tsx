'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, describedBy } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { signInAction } from '@/lib/auth/actions'
import { EMPTY_AUTH_STATE } from '@/lib/auth/form-state'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  )
}

export function LoginForm() {
  const [state, action] = useActionState(signInAction, EMPTY_AUTH_STATE)
  const fieldErrors = state.fieldErrors ?? {}

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Field label="Email" htmlFor="email" error={fieldErrors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={describedBy('email', { error: fieldErrors.email })}
        />
      </Field>

      <Field label="Password" htmlFor="password" error={fieldErrors.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={describedBy('password', { error: fieldErrors.password })}
        />
      </Field>

      <Submit />
    </form>
  )
}
