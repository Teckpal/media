import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { dayKeyInZone } from '@/lib/time'
import type { EngagementPoint, EngagementSeries, Grain } from '@/lib/analytics/grain'

export type { EngagementPoint, EngagementSeries, Grain } from '@/lib/analytics/grain'
export { GRAINS, isGrain } from '@/lib/analytics/grain'

/**
 * Views and interactions over time, for the dashboard.
 *
 * THERE IS NO METRICS DATA YET, AND THIS SAYS SO RATHER THAN INVENTING IT.
 * Section 11 puts analytics in Phase 2: nothing stores a view count, no
 * platform connection is live, and the schema has no metrics table. So the
 * series below is marked `sample` and the card that draws it says as much on
 * its face.
 *
 * What is NOT sample is the shape: the buckets are the workspace's real posts,
 * on the real days they went out, in the workspace's own timezone. When a
 * metrics table and a live connection exist, `readMetrics` is the only function
 * that changes — the chart, the buckets and the timezone handling stay.
 *
 * The numbers are derived from each post's id rather than random, so the chart
 * does not reshuffle itself on every render and a screenshot stays true.
 */

/** A stable pseudo-number from a string, so a given post always reads the same. */
function seeded(id: string, salt: number): number {
  let hash = 2166136261 ^ salt
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash % 1000) / 1000
}

type PostRow = { id: string; caption: string; scheduled_at: string | null }

export async function readEngagement(
  workspaceId: string,
  timezone: string,
  grain: Grain,
): Promise<EngagementSeries> {
  const supabase = await createClient()

  // Only posts that actually went out can have been seen by anybody.
  const { data, error } = await supabase
    .from('posts')
    .select('id, caption, scheduled_at')
    .eq('workspace_id', workspaceId)
    .in('status', ['published', 'scheduled'])
    .not('scheduled_at', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(400)
    .returns<PostRow[]>()

  // An unreadable table is not an empty one. Collapsing the two made the card
  // say "Nothing has gone out yet" to a workspace with a year of posts in it.
  if (error) {
    return { grain, points: [], totals: { views: 0, interactions: 0 }, sample: true, unavailable: true }
  }

  const posts = data ?? []

  if (posts.length === 0) {
    return { grain, points: [], totals: { views: 0, interactions: 0 }, sample: true }
  }

  const measured = posts.map((post) => {
    const views = 40 + Math.round(seeded(post.id, 1) * 460)
    return {
      post,
      views,
      // Interactions are a slice of views, never more — a chart where the two
      // lines cross would be describing something impossible.
      interactions: Math.round(views * (0.03 + seeded(post.id, 2) * 0.12)),
    }
  })

  let points: EngagementPoint[]

  if (grain === 'post') {
    points = measured.slice(-12).map(({ post, views, interactions }) => ({
      label: post.caption.trim().slice(0, 18) || 'Untitled',
      views,
      interactions,
    }))
  } else {
    const buckets = new Map<string, EngagementPoint>()

    for (const { post, views, interactions } of measured) {
      const dayKey = dayKeyInZone(post.scheduled_at!, timezone)
      const key = grain === 'month' ? dayKey.slice(0, 7) : weekKey(dayKey)

      const bucket = buckets.get(key) ?? { label: bucketLabel(key, grain), views: 0, interactions: 0 }
      bucket.views += views
      bucket.interactions += interactions
      buckets.set(key, bucket)
    }

    points = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, point]) => point)
      .slice(-12)
  }

  return {
    grain,
    points,
    totals: {
      views: points.reduce((sum, point) => sum + point.views, 0),
      interactions: points.reduce((sum, point) => sum + point.interactions, 0),
    },
    sample: true,
  }
}

/**
 * The Monday of the week a `YYYY-MM-DD` falls in.
 *
 * Built with `Date.UTC` as plain calendar arithmetic — the day key already
 * names a day in the workspace's zone, so converting it again would move it.
 */
function weekKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const shift = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - shift)
  return date.toISOString().slice(0, 10)
}

function bucketLabel(key: string, grain: Grain): string {
  if (grain === 'month') {
    const [year, month] = key.split('-').map(Number)
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, 1)))
  }

  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)))
}
