'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { connectSelectedAction } from '@/lib/connections/actions'
import { EMPTY_FORM_STATE } from '@/lib/forms'
import { cn } from '@/lib/utils'

export type Choice = {
  externalAccountId: string
  displayName: string
  username?: string
  avatarUrl?: string
  accountType: string
  /** Already live in this workspace, so there is nothing to add. */
  alreadyHere: boolean
}

/**
 * Which accounts to connect.
 *
 * Nothing is ticked by default. Section 7.1 bills per connected account, so
 * pre-selecting every Page a user happens to administer would quietly commit
 * them to paying for all of them.
 */
export function Picker({
  sessionId,
  choices,
}: {
  sessionId: string
  choices: Choice[]
}) {
  const [state, action, pending] = useActionState(
    connectSelectedAction,
    EMPTY_FORM_STATE,
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectable = choices.filter((c) => !c.alreadyHere)

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="session" value={sessionId} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.notice ? <Alert tone="warning">{state.notice}</Alert> : null}

      <fieldset className="space-y-2">
        <legend className="sr-only">Accounts to connect</legend>

        {choices.map((choice) => {
          const checked = selected.has(choice.externalAccountId)

          return (
            <label
              key={choice.externalAccountId}
              className={cn(
                'flex items-center gap-3 rounded-[var(--radius)] border p-3 transition-colors',
                choice.alreadyHere
                  ? 'cursor-not-allowed border-border bg-surface-muted opacity-70'
                  : checked
                    ? 'cursor-pointer border-primary bg-surface-muted'
                    : 'cursor-pointer border-border bg-surface hover:bg-surface-muted',
              )}
            >
              <input
                type="checkbox"
                name="account"
                value={choice.externalAccountId}
                checked={checked}
                disabled={choice.alreadyHere}
                onChange={() => toggle(choice.externalAccountId)}
                className="size-4 accent-[var(--primary)]"
              />

              {choice.avatarUrl ? (
                // Avatar URLs are signed, short-lived and served from platform
                // CDNs whose hostnames cannot be listed in next.config ahead of
                // time, so next/image has nothing to optimise here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={choice.avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  className="size-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="size-8 shrink-0 rounded-full bg-surface-muted" aria-hidden />
              )}

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {choice.displayName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {choice.username ? `@${choice.username} · ` : null}
                  {choice.accountType}
                  {choice.alreadyHere ? ' · already connected here' : null}
                </span>
              </span>
            </label>
          )
        })}
      </fieldset>

      <p className="text-sm text-muted-foreground">
        Each connected account is billed separately. Connect only what you plan
        to post to — you can add more later.
      </p>

      <Button
        type="submit"
        size="lg"
        disabled={pending || selected.size === 0 || selectable.length === 0}
      >
        {pending
          ? 'Connecting…'
          : selected.size === 0
            ? 'Choose an account'
            : `Connect ${selected.size}`}
      </Button>
    </form>
  )
}
