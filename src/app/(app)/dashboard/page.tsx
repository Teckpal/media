import type { Metadata } from 'next'
import { Card } from '@/components/ui/card'
import { requireDashboard } from '@/lib/auth/gate'

export const metadata: Metadata = { title: 'Dashboard' }

/**
 * Placeholder. Fills out in Module 5 (posts and calendar) and Module 8
 * (notifications); it exists now to prove the gate.
 */
export default async function DashboardPage() {
  const { user, active } = await requireDashboard()

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

      <Card>
        <p className="text-sm text-muted-foreground">
          Posts, the calendar and the AI Planner land here as the modules are
          built.
        </p>
      </Card>
    </div>
  )
}
