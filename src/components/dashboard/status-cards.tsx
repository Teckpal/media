import Link from 'next/link'
import { ROUTES } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The state of the week, four cards wide.
 *
 * Every number here is also reachable from the Posts board, which is the
 * point: this is the glance, that is the work. A dashboard whose cards do not
 * go anywhere is decoration, so each one links to the board filtered to itself.
 *
 * The bar under each card is a share of the largest column, not a percentage of
 * anything real. It exists so the four can be compared without reading them —
 * eleven drafts next to one scheduled post is a shape you should be able to see
 * from across the desk.
 */

export type StatusCard = {
  key: string
  label: string
  blurb: string
  count: number
  href: string
  /** Tailwind gradient stops, kept together so the set reads as a palette. */
  gradient: string
}

export function StatusCards({ cards }: { cards: StatusCard[] }) {
  // Share of the busiest card. Guarded, because every count can be zero on a
  // new workspace and a bar of NaN renders as nothing with no explanation.
  const peak = Math.max(1, ...cards.map((card) => card.count))

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Link
          key={card.key}
          href={card.href}
          className={cn(
            'group relative flex flex-col justify-between overflow-hidden rounded-[var(--radius)] p-4 text-white transition-transform hover:-translate-y-0.5',
            card.gradient,
          )}
        >
          <div>
            <p className="text-3xl leading-none font-semibold">{card.count}</p>
            <p className="mt-2 text-sm font-medium">{card.label}</p>
            <p className="mt-0.5 text-xs text-pretty text-white/75">{card.blurb}</p>
          </div>

          {/* Sits on the card's own bottom edge, as on the reference layout. */}
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-1.5 bg-white/25"
            style={{ width: `${Math.round((card.count / peak) * 100)}%` }}
          />
        </Link>
      ))}
    </div>
  )
}

/**
 * The four cards, from counts.
 *
 * Kept here rather than in the page so the labels and the links stay next to
 * the component that renders them — and so the one rule worth stating lives in
 * one place: **every card links to the board**, because the board is where you
 * act on what the card just told you.
 */
export function buildStatusCards(counts: {
  drafts: number
  scheduled: number
  published: number
  failed: number
}): StatusCard[] {
  const board = `${ROUTES.posts}?view=board`

  return [
    {
      key: 'scheduled',
      label: 'Scheduled',
      blurb: 'Waiting for their time',
      count: counts.scheduled,
      href: board,
      // The accent itself: this is the card the dashboard is about.
      gradient: 'bg-gradient-to-br from-[#d81b43] to-[#9e1032]',
    },
    {
      key: 'drafts',
      label: 'Drafts',
      blurb: 'Written, not yet dated',
      count: counts.drafts,
      href: board,
      // Neutral on purpose. A draft is not an event, and a second saturated
      // card beside the accent would make the row read as two alarms.
      gradient: 'bg-gradient-to-br from-slate-500 to-slate-700',
    },
    {
      key: 'published',
      label: 'Published',
      blurb: 'Live on the platforms',
      count: counts.published,
      href: board,
      gradient: 'bg-gradient-to-br from-emerald-600 to-emerald-800',
    },
    {
      key: 'failed',
      label: 'Needs attention',
      blurb: counts.failed === 0 ? 'Nothing is stuck' : 'Did not go out',
      count: counts.failed,
      href: board,
      // Amber rather than red, and now for a second reason: red is the
      // product's accent, so a red card here would read as the primary thing
      // to look at rather than the thing that went wrong.
      gradient: 'bg-gradient-to-br from-amber-500 to-amber-700',
    },
  ]
}
