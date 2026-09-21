import { Check } from 'lucide-react'
import type { OnboardingStep } from '@/lib/constants'
import { VISIBLE_STEPS, isStepComplete } from '@/lib/onboarding/steps'
import { cn } from '@/lib/utils'

/**
 * The four numbered steps from Section 4. Shows where the user is, and what is
 * already behind them — Section 5's "resume anywhere" is easier to trust when
 * the saved progress is visible.
 */
export function Stepper({ current }: { current: OnboardingStep }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Setup progress">
      {VISIBLE_STEPS.map(({ step, label }, index) => {
        const done = isStepComplete(current, step)
        const active = current === step

        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs font-medium',
                done && 'bg-success-subtle text-foreground',
                active && 'bg-primary text-primary-foreground',
                !done && !active && 'bg-surface-muted text-muted-foreground',
              )}
              aria-hidden
            >
              {done ? <Check className="size-3.5" /> : index + 1}
            </span>

            <span
              className={cn(
                'text-sm',
                active ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {label}
              {done ? <span className="sr-only"> (done)</span> : null}
            </span>

            {index < VISIBLE_STEPS.length - 1 ? (
              <span className="ml-1 hidden h-px w-6 bg-border sm:block" aria-hidden />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
