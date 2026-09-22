import { chooseRegionAction } from '@/lib/marketing/actions'
import type { BillingRegion } from '@/lib/constants'

const LABELS: Record<BillingRegion, string> = {
  bd: 'Bangladesh',
  global: 'Rest of the world',
}

/**
 * The region toggle (Section 7A.2 rule 1).
 *
 * A plain form posting to a server action, so it works before JavaScript
 * arrives and on a browser that never runs it. A landing page is the one page
 * where that is not a theoretical concern — it is the first thing anyone loads,
 * often on a slow connection.
 */
export function RegionSwitch({ current }: { current: BillingRegion }) {
  return (
    <form action={chooseRegionAction} className="flex items-center gap-1">
      <span className="sr-only" id="region-switch-label">
        Choose where you are, to see the right prices
      </span>

      <div
        role="group"
        aria-labelledby="region-switch-label"
        className="inline-flex rounded-full border border-white/20 p-0.5"
      >
        {(['bd', 'global'] as const).map((region) => {
          const isCurrent = region === current

          return (
            <button
              key={region}
              type="submit"
              name="region"
              value={region}
              aria-current={isCurrent ? 'true' : undefined}
              className={
                isCurrent
                  ? 'rounded-full bg-white px-3 py-1 text-xs font-medium text-[var(--night)]'
                  : 'rounded-full px-3 py-1 text-xs text-white/65 transition-colors hover:text-white'
              }
            >
              {LABELS[region]}
            </button>
          )
        })}
      </div>
    </form>
  )
}
