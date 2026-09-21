/**
 * Shared result shape for `useActionState` forms.
 *
 * Kept out of any `'use server'` module, which may only export async functions.
 */
export type FormState = {
  error: string | null
  /** Per-field messages, keyed by input name. */
  fieldErrors?: Record<string, string>
  notice?: string
}

export const EMPTY_FORM_STATE: FormState = { error: null }

/** Flattens a zod error into one message per field. */
export function fieldErrorsFrom(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form')
    out[key] ??= issue.message
  }
  return out
}
