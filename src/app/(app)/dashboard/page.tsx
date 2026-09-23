import type { Metadata } from 'next'
import { Card } from '@/components/ui/card'
import { EngagementChart } from '@/components/dashboard/engagement-chart'
import { StatusCards, buildStatusCards } from '@/components/dashboard/status-cards'
import { requireDashboard } from '@/lib/auth/gate'
import { isGrain, readEngagement, type Grain } from '@/lib/analytics/engagement'
import type { PostStatus } from '@/lib/constants'
import { createClient } from '@/lib/supabase/server'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'Dashboard' }

/**
 * The workspace's front page.
 *
 * The grain lives in the query string rather than in component state, so the
 * view survives a reload, can be linked to, and is read on the server — which
 * is also what keeps the series query out of the browser.
 */
export default async function DashboardPage({ searchParams }: PageProps<'/dashboard'>) {
  const { user, active } = await requireDashboard()

  const params = await searchParams
  const grain: Grain = isGrain(params.by) ? params.by : 'week'

  const series = await readEngagement(active.workspace.id, active.workspace.timezone, grain)
  const counts = await readStatusCounts(active.workspace.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {user.profile.full_name
            ? `Welcome back, ${user.profile.full_name.split(' ')[0]}`
            : 'Welcome back'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {active.workspace.name} · times shown in {active.workspace.timezone}
        </p>
      </div>

      <StatusCards cards={buildStatusCards(counts)} />

      <EngagementChart series={series} basePath={ROUTES.dashboard} />

      <Card>
        <p className="text-sm text-muted-foreground">
          The AI Planner lands here as the modules are built.
        </p>
      </Card>
    </div>
  )
}

/**
 * How many posts are in each state.
 *
 * Four `head: true` counts rather than one query returning every row and a
 * tally in JavaScript: the dashboard needs the numbers, not the posts, and a
 * workspace with two thousand published posts should not send two thousand
 * rows to produce the digit `4`.
 *
 * A failed count returns zero and says so in the log. The alternative — a
 * dashboard that refuses to render because one badge could not be worked out —
 * is worse than a dashboard with a wrong badge on it.
 */
async function readStatusCounts(workspaceId: string): Promise<{
  drafts: number
  scheduled: number
  published: number
  failed: number
}> {
  const supabase = await createClient()

  const count = async (statuses: PostStatus[]): Promise<number> => {
    const { count: n, error } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .in('status', statuses)

    if (error) {
      console.error('[dashboard] count failed for %s: %s', statuses.join('/'), error.message)
      return 0
    }

    return n ?? 0
  }

  const [drafts, scheduled, published, failed] = await Promise.all([
    count(['draft']),
    count(['scheduled', 'pending_approval', 'publishing']),
    count(['published']),
    count(['failed']),
  ])

  return { drafts, scheduled, published, failed }
}
