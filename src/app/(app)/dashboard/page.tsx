import type { Metadata } from 'next'
import { Card } from '@/components/ui/card'
import { EngagementChart } from '@/components/dashboard/engagement-chart'
import { requireDashboard } from '@/lib/auth/gate'
import { isGrain, readEngagement, type Grain } from '@/lib/analytics/engagement'
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

      <EngagementChart series={series} basePath={ROUTES.dashboard} />

      <Card>
        <p className="text-sm text-muted-foreground">
          Posts, the calendar and the AI Planner land here as the modules are
          built.
        </p>
      </Card>
    </div>
  )
}
