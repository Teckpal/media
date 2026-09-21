'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Building2, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { chooseModuleAction } from '@/lib/onboarding/actions'
import { EMPTY_FORM_STATE } from '@/lib/forms'
import { cn } from '@/lib/utils'

/**
 * Section 3. Personal and Business only — Self (MOTiF) is assigned by a
 * platform admin and never offered in public signup, so it is not on this
 * screen and the server action does not accept it either.
 */
const OPTIONS = [
  {
    value: 'personal',
    icon: User,
    title: 'Personal',
    blurb: 'You, posting as yourself. One workspace, no team.',
  },
  {
    value: 'business',
    icon: Building2,
    title: 'Business',
    blurb: 'One brand, with teammates and roles.',
  },
] as const

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? 'Saving…' : 'Continue'}
    </Button>
  )
}

export function ModuleChoice({ initial }: { initial: string | null }) {
  const [state, action] = useActionState(chooseModuleAction, EMPTY_FORM_STATE)
  const [chosen, setChosen] = useState(initial ?? 'personal')

  return (
    <form action={action} className="space-y-6">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <fieldset className="space-y-3">
        <legend className="sr-only">Choose a module</legend>

        {OPTIONS.map(({ value, icon: Icon, title, blurb }) => (
          <label
            key={value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border p-4 transition-colors',
              chosen === value
                ? 'border-primary bg-surface-muted'
                : 'border-border bg-surface hover:bg-surface-muted',
            )}
          >
            <input
              type="radio"
              name="module"
              value={value}
              checked={chosen === value}
              onChange={() => setChosen(value)}
              className="mt-1 size-4 accent-[var(--primary)]"
            />
            <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block font-medium">{title}</span>
              <span className="block text-sm text-muted-foreground">{blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <Submit />
    </form>
  )
}
