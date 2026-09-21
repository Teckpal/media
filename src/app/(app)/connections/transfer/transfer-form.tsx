'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field, describedBy } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { requestTransferAction } from '@/lib/connections/actions'
import { EMPTY_FORM_STATE } from '@/lib/forms'
import { PLATFORM_LABELS, type Platform } from '@/lib/constants'

export function TransferForm({ platforms }: { platforms: Platform[] }) {
  const [state, action, pending] = useActionState(
    requestTransferAction,
    EMPTY_FORM_STATE,
  )
  const errors = state.fieldErrors ?? {}

  if (state.notice) {
    return <Alert tone="success" title="Request received">{state.notice}</Alert>
  }

  return (
    <form action={action} className="space-y-5">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Field label="Platform" htmlFor="platform">
        <Select id="platform" name="platform" defaultValue={platforms[0]}>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Account id or handle"
        htmlFor="externalAccountId"
        hint="The Page id, or the @handle exactly as it appears on the platform."
        error={errors.externalAccountId}
      >
        <Input
          id="externalAccountId"
          name="externalAccountId"
          required
          maxLength={200}
          aria-invalid={Boolean(errors.externalAccountId)}
          aria-describedby={describedBy('externalAccountId', {
            error: errors.externalAccountId,
            hint: true,
          })}
        />
      </Field>

      <Field
        label="Why it should move to you"
        htmlFor="evidence"
        hint="Support verifies ownership with the platform itself, so tell us who you are in relation to the account."
        error={errors.evidence}
      >
        <Textarea
          id="evidence"
          name="evidence"
          rows={5}
          required
          minLength={20}
          maxLength={4000}
          aria-invalid={Boolean(errors.evidence)}
          aria-describedby={describedBy('evidence', {
            error: errors.evidence,
            hint: true,
          })}
        />
      </Field>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit request'}
      </Button>
    </form>
  )
}
