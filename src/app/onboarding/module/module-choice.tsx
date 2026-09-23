'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
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
    title: 'Solo',
    blurb:
      'You, posting as yourself. Straight to your dashboard — no setup to fill in.',
  },
  {
    value: 'business',
    icon: Building2,
    title: 'Team',
    blurb:
      'A brand, with teammates and roles. A few questions first, so the app knows what it is posting for.',
  },
] as const

function Submit({ solo }: { solo: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? 'Setting up…' : solo ? 'Go to my dashboard' : 'Continue'}
    </Button>
  )
}

export function ModuleChoice({ initial }: { initial: string | null }) {
  const [state, action] = useActionState(chooseModuleAction, EMPTY_FORM_STATE)
  const [chosen, setChosen] = useState(initial ?? 'personal')
  const timezoneRef = useRef<HTMLInputElement | null>(null)

  /**
   * Filled in after mount, by writing to the DOM rather than through state.
   *
   * Rendering `Intl.DateTimeFormat().resolvedOptions().timeZone` would run on
   * the server too, where it reports the *server's* zone — so the first paint
   * and the hydrated one would disagree, and the value posted would be
   * whatever the host machine happens to be set to. Writing the field after
   * mount means only the browser ever answers, and it costs no extra render.
   */
  useEffect(() => {
    if (!timezoneRef.current) return
    try {
      timezoneRef.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    } catch {
      /* the server falls back when this arrives empty */
    }
  }, [])

  return (
    <form action={action} className="space-y-6">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      {/* The browser's own zone, for the solo path that skips the setup form.
          Read rather than asked for: the machine already knows, and this is
          the one field that cannot be guessed wrong harmlessly — it decides
          what "9am" means for every post scheduled afterwards. The server
          validates it and falls back if it arrives empty or nonsense. */}
      <input type="hidden" name="timezone" ref={timezoneRef} defaultValue="" />

      <fieldset className="space-y-3">
        <legend className="sr-only">Choose how you will use this</legend>

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

      <Submit solo={chosen === 'personal'} />
    </form>
  )
}

