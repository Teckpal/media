import Link from 'next/link'
import {
  BarChart3,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  Link2,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react'
import { Wordmark } from '@/components/brand/wordmark'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/lib/routes'
import { requireDashboard } from '@/lib/auth/gate'
import { signOutAction } from '@/lib/auth/actions'

const NAV = [
  { href: ROUTES.dashboard, label: 'Dashboard', icon: LayoutDashboard },
  { href: ROUTES.posts, label: 'Posts', icon: BarChart3 },
  { href: ROUTES.calendar, label: 'Calendar', icon: CalendarDays },
  { href: ROUTES.aiPlanner, label: 'AI Planner', icon: Sparkles },
  { href: ROUTES.connections, label: 'Connections', icon: Link2 },
  { href: ROUTES.team, label: 'Team', icon: Users },
  { href: ROUTES.billing, label: 'Billing', icon: CreditCard },
  { href: ROUTES.settings, label: 'Settings', icon: Settings },
]

/**
 * Everything under this layout is behind gate 1 of Section 4. `requireDashboard`
 * either returns a user who has a verified email, finished onboarding and at
 * least one live connection, or it redirects and never returns.
 *
 * It runs on the server on every render of every page in the group, so there is
 * no route in here that can be reached by guessing its URL.
 */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const { user, active } = await requireDashboard()

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="border-b border-border bg-surface lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-4 lg:block lg:space-y-4">
          <Link href={ROUTES.dashboard}>
            <Wordmark />
          </Link>

          <div className="min-w-0 lg:pt-1">
            <p className="truncate text-sm font-medium">{active.workspace.name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {active.workspace.type} · {active.role}
            </p>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible lg:px-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-border px-4 py-3 sm:px-6">
          <span className="truncate text-sm text-muted-foreground">{user.email}</span>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
