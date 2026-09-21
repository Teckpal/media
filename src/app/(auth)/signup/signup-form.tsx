'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, describedBy } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { signUpAction } from '@/lib/auth/actions'
import { EMPTY_AUTH_STATE } from '@/lib/auth/form-state'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? 'Creating account…' : 'Create account'}
    </Button>
  )
}

export function SignupForm({ country }: { country: string | null }) {
  const [state, action] = useActionState(signUpAction, EMPTY_AUTH_STATE)
  const fieldErrors = state.fieldErrors ?? {}

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      {/*
        Section 7A.2: the country guessed from the visitor's IP travels with the
        signup as one input into the region guess. It is a hint for which
        paywall to show first and nothing more — the payment method decides
        what is actually charged.
      */}
      <input type="hidden" name="country" value={country ?? ''} />

      <Field label="Your name" htmlFor="fullName" error={fieldErrors.fullName}>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          aria-invalid={Boolean(fieldErrors.fullName)}
          aria-describedby={describedBy('fullName', { error: fieldErrors.fullName })}
        />
      </Field>

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

      <Field
        label="Password"
        htmlFor="password"
        hint="At least 10 characters."
        error={fieldErrors.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={describedBy('password', {
            error: fieldErrors.password,
            hint: true,
          })}
        />
      </Field>

      <Submit />
    </form>
  )
}
