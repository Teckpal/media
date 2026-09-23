'use client'

import { useActionState } from 'react'
import { FlaskConical, Plus } from 'lucide-react'
import { connectDemoAccountAction } from '@/lib/connections/actions'
import { buttonStyles } from '@/components/ui/button'
import { PLATFORM_LABELS, type Platform } from '@/lib/constants'
import { EMPTY_FORM_STATE } from '@/lib/forms'

/**
 * Demo accounts, offered one per platform.
 *
 * Shown only while `OPEN_ACCESS` is on, and the action refuses regardless of
 * what this renders — the flag here decides whether to *offer* it, never
 * whether it is allowed.
 *
 * Platforms already connected, demo or real, are not offered again: the
 * database would refuse the second one anyway, and a button whose only
 * outcome is an error message is a button that should not be there.
 */
export function DemoAccounts({ available }: { available: Platform[] }) {
  const [state, action, pending] = useActionState(
    connectDemoAccountAction,
    EMPTY_FORM_STATE,
  )

  if (available.length === 0 && !state.notice && !state.error) return null

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <FlaskConical className="size-3.5 text-muted-foreground" aria-hidden />
          Demo accounts
        </p>
        <p className="text-xs text-pretty text-muted-foreground">
          Props, while we wait on the platforms&rsquo; own credentials. You can
          preview against them, schedule against them and see the calendar fill
          up — but they hold no access token, so nothing will ever be published
          through one.
        </p>
      </div>

      {state.error ? (
        <p className="rounded-[var(--radius)] border border-danger/40 bg-danger/5 px-3 py-2 text-sm">
          {state.error}
        </p>
      ) : null}

      {state.notice ? (
        <p className="rounded-[var(--radius)] border border-success/40 bg-success/5 px-3 py-2 text-sm">
          {state.notice}
        </p>
      ) : null}

      {available.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {available.map((platform) => (
            <form key={platform} action={action}>
              <input type="hidden" name="platform" value={platform} />
              <button
                type="submit"
                disabled={pending}
                className={buttonStyles({ variant: 'ghost', size: 'sm' })}
              >
                <Plus className="size-3.5" aria-hidden />
                {PLATFORM_LABELS[platform]}
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Every platform already has an account here.
        </p>
      )}
    </div>
  )
}
