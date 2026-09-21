/**
 * Shared shape for auth form results.
 *
 * Lives outside `actions.ts` because a `'use server'` module may only export
 * async functions — a plain constant there is a build error.
 */
export type AuthFormState = {
  error: string | null
  /** Per-field messages, keyed by input name. */
  fieldErrors?: Record<string, string>
  notice?: string
}

export const EMPTY_AUTH_STATE: AuthFormState = { error: null }
