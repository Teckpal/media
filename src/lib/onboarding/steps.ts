import type { OnboardingStep } from '@/lib/constants'
import { ONBOARDING_ROUTE } from '@/lib/routes'

/**
 * Section 5, rule 1: onboarding is a saved state machine and the user resumes
 * wherever they left. That only holds if there is one ordering, so this is it.
 */
export const STEP_ORDER: readonly OnboardingStep[] = [
  'verify_email',
  'choose_module',
  'setup',
  'connect',
  'first_draft',
  'paywall',
  'done',
] as const

/**
 * The four numbered steps the user actually sees.
 *
 * `verify_email` and `choose_module` come before the progress bar starts:
 * verification is a gate rather than a step, and picking a module is the
 * question the steps are then about.
 */
export const VISIBLE_STEPS = [
  { step: 'setup', label: 'Set up' },
  { step: 'connect', label: 'Connect' },
  { step: 'first_draft', label: 'First post' },
  { step: 'paywall', label: 'Plan' },
] as const satisfies readonly { step: OnboardingStep; label: string }[]

export function stepPosition(step: OnboardingStep): number {
  return STEP_ORDER.indexOf(step)
}

/** Has the user already passed this step? */
export function isStepComplete(current: OnboardingStep, step: OnboardingStep): boolean {
  return stepPosition(current) > stepPosition(step)
}

/**
 * The next step after this one. The machine only ever moves forward, so a user
 * re-submitting a finished step cannot knock themselves backwards.
 */
export function nextStep(step: OnboardingStep): OnboardingStep {
  const index = stepPosition(step)
  return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)]
}

/**
 * Picks whichever of two steps is further along.
 *
 * Every advance goes through this, which is what makes the writes idempotent:
 * finishing setup twice, or clicking an old link, can never move a user back.
 */
export function furthest(a: OnboardingStep, b: OnboardingStep): OnboardingStep {
  return stepPosition(a) >= stepPosition(b) ? a : b
}

export function routeForStep(step: OnboardingStep): string {
  return ONBOARDING_ROUTE[step]
}
