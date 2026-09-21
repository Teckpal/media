import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Composer } from '../composer'
import { Alert } from '@/components/ui/alert'
import { requireWorkspace } from '@/lib/auth/gate'
import { loadTargetOptions } from '@/lib/posts/queries'
import { canPublish, explainBlock } from '@/lib/billing/entitlements'
import { atLeast } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = { title: 'New post' }

export default async function NewPostPage() {
  const { active } = await requireWorkspace()

  if (!atLeast(active.role, 'editor')) {
    redirect(`${ROUTES.posts}?error=forbidden`)
  }

  const targets = await loadTargetOptions(active.workspace.id)

  // Gate 2, asked in its weaker form: may this workspace schedule anything at
  // all? The per-account check happens again on submit, for the exact accounts
  // chosen (Section 4).
  const entitlement = await canPublish(active.workspace, [])

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New post</h1>

      {targets.length === 0 ? (
        <Alert tone="warning" title="Nothing is connected">
          You can write and keep drafts, but there is nowhere to send them yet.
        </Alert>
      ) : null}

      <Composer
        workspaceId={active.workspace.id}
        timezone={active.workspace.timezone}
        targets={targets}
        defaults={{ caption: '', media: [], accountIds: [], scheduledLocal: '' }}
        locked={false}
        canSchedule={entitlement.allowed}
        scheduleBlockReason={entitlement.allowed ? null : explainBlock(entitlement.block)}
        mustReschedule={false}
      />
    </div>
  )
}
