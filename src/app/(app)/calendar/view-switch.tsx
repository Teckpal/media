import Link from 'next/link'
import { ROUTES } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * Month or week.
 *
 * Links, not buttons. The view is in the URL, which means it survives a
 * refresh, can be bookmarked, and is what the composer's redirect can point
 * at — a client toggle holding it in state would lose all three.
 */
export function ViewSwitch({
  view,
  monthHref,
  weekHref,
}: {
  view: 'month' | 'week'
  monthHref: string
  weekHref: string
}) {
  return (
    <div className="inline-flex rounded-[var(--radius)] border border-border p-0.5">
      {(
        [
          { key: 'month', label: 'Month', href: monthHref },
          { key: 'week', label: 'Week', href: weekHref },
        ] as const
      ).map((option) => (
        <Link
          key={option.key}
          href={option.href}
          aria-current={view === option.key ? 'page' : undefined}
          className={cn(
            'rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-sm transition-colors',
            view === option.key
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
          )}
        >
          {option.label}
        </Link>
      ))}
    </div>
  )
}

/** Where "Today" goes, keeping whichever view is open. */
export function todayHref(view: 'month' | 'week'): string {
  return view === 'week' ? `${ROUTES.calendar}?view=week` : ROUTES.calendar
}
