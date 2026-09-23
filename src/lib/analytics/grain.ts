/**
 * The vocabulary of the engagement chart: no imports, no server, no database.
 *
 * Split out from `engagement.ts` because the chart is a client component and
 * needs `GRAINS` and these types. Importing them from the query module dragged
 * `server-only` and the Supabase server client into the browser bundle and
 * failed the build — the types were harmless, the module they lived in was not.
 */

export type Grain = 'post' | 'week' | 'month'

export type EngagementPoint = {
  /** Axis label: a post's caption, a week ending, or a month. */
  label: string
  views: number
  interactions: number
}

export type EngagementSeries = {
  grain: Grain
  points: EngagementPoint[]
  totals: { views: number; interactions: number }
  /** True while the numbers are illustrative. Draw a badge when it is. */
  sample: boolean
  /** The series could not be read at all — distinct from having no posts. */
  unavailable?: boolean
}

export const GRAINS: { value: Grain; label: string }[] = [
  { value: 'post', label: 'Per post' },
  { value: 'week', label: 'Per week' },
  { value: 'month', label: 'Per month' },
]

export function isGrain(value: unknown): value is Grain {
  return value === 'post' || value === 'week' || value === 'month'
}
