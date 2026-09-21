import type { ReactNode } from 'react'

type Props = {
  label: string
  /** Must match the control's `id`, and is the stem for the message ids. */
  htmlFor: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
}

/**
 * Label, control, and the one message that belongs to it.
 *
 * The control keeps its own `aria-describedby`; pass `describedBy(htmlFor, ...)`
 * so the message below is announced with it.
 */
export function Field({ label, htmlFor, hint, error, children }: Props) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** The id of whichever message `Field` is currently showing, if any. */
export function describedBy(
  htmlFor: string,
  opts: { error?: string | null; hint?: unknown },
): string | undefined {
  if (opts.error) return `${htmlFor}-error`
  if (opts.hint) return `${htmlFor}-hint`
  return undefined
}
