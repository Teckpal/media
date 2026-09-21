'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Alert } from '@/components/ui/alert'
import { saveFirstDraftAction, skipFirstDraftAction } from '@/lib/onboarding/actions'
import { EMPTY_FORM_STATE } from '@/lib/forms'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? 'Saving…' : 'Save draft and continue'}
    </Button>
  )
}

export function DraftForm() {
  const [state, action] = useActionState(saveFirstDraftAction, EMPTY_FORM_STATE)

  return (
    <div className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <form action={action} className="space-y-4">
        <Field
          label="Your first post"
          htmlFor="caption"
          hint="This is saved as a draft. Nothing publishes from here."
        >
          <Textarea
            id="caption"
            name="caption"
            rows={6}
            maxLength={5000}
            aria-describedby="caption-hint"
            placeholder="Say hello, announce something, or jot down an idea for later."
          />
        </Field>

        <Submit />
      </form>

      {/* Section 5, rule 4: the step is soft. Moving on without writing
          anything is a first-class choice, not a hidden escape. */}
      <form action={skipFirstDraftAction}>
        <Button type="submit" variant="ghost" size="sm">
          Skip for now
        </Button>
      </form>
    </div>
  )
}
