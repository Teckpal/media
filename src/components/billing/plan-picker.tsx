'use client'

import { useActionState } from 'react'
import { Check } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { startCheckoutAction } from '@/lib/billing/actions'
import { EMPTY_FORM_STATE } from '@/lib/forms'

export type PlanOption = {
  code: string
  displayName: string
  description: string | null
  priceLabel: string
  aiCredits: number
  maxSeats: number | null
  /** The total this workspace would actually pay, seats included. */
  totalLabel: string
  /** Too many connected accounts for this package. */
  tooSmall: boolean
  current: boolean
}

/**
 * The packages, priced for this workspace.
 *
 * Every number shown here was read from `plans` on the server and multiplied
 * by a seat count read from the database (Section 7A.3). The form posts a plan
 * *code* and nothing else — there is no field in which a price could travel.
 */
export function PlanPicker({
  plans,
  seats,
  canPay,
  unavailableReason,
}: {
  plans: PlanOption[]
  seats: number
  canPay: boolean
  unavailableReason: string | null
}) {
  const [state, action, pending] = useActionState(startCheckoutAction, EMPTY_FORM_STATE)

  return (
    <div className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      {unavailableReason ? <Alert tone="warning">{unavailableReason}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.code} className="flex flex-col gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{plan.displayName}</p>
                {plan.current ? (
                  <span className="rounded-full bg-success-subtle px-2 py-0.5 text-xs text-success">
                    Current
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {plan.priceLabel}
              </p>
              <p className="text-xs text-muted-foreground">per account / month</p>
            </div>

            {plan.description ? (
              <p className="text-sm text-muted-foreground">{plan.description}</p>
            ) : null}

            <ul className="space-y-1.5 text-sm">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {plan.aiCredits.toLocaleString()} AI credits a month
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {plan.maxSeats ? `Up to ${plan.maxSeats} accounts` : 'Unlimited accounts'}
              </li>
            </ul>

            <div className="mt-auto space-y-2">
              <p className="text-sm">
                <span className="font-medium">{plan.totalLabel}</span>{' '}
                <span className="text-muted-foreground">
                  for your {seats} {seats === 1 ? 'account' : 'accounts'}
                </span>
              </p>

              {plan.tooSmall ? (
                <p className="text-xs text-muted-foreground">
                  This package covers up to {plan.maxSeats} accounts.
                </p>
              ) : (
                <form action={action}>
                  <input type="hidden" name="planCode" value={plan.code} />
                  <Button
                    type="submit"
                    variant={plan.current ? 'secondary' : 'primary'}
                    fullWidth
                    disabled={pending || !canPay}
                  >
                    {pending ? 'One moment…' : plan.current ? 'Renew' : `Choose ${plan.displayName}`}
                  </Button>
                </form>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
