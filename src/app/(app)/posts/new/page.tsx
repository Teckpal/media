import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Composer } from '../composer'
import { Alert } from '@/components/ui/alert'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import { loadTargetOptions } from '@/lib/posts/queries'
import { canPublish, explainBlock } from '@/lib/billing/entitlements'
import { atLeast } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import { todayInZone } from '@/lib/time'
import type { HashtagProfile } from '@/lib/posts/hashtags'

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
  const profile = await loadHashtagProfile(await createClient(), active.workspace.id)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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
        today={todayInZone(active.workspace.timezone)}
        profile={profile}
      />
    </div>
  )
}

/**
 * The brand profile, for hashtag suggestions.
 *
 * `error` is bound and logged: a failed read and an unfilled profile both
 * produce no suggestions, and only one of them is a fact. Either way the
 * composer still works — suggestions are a convenience, and losing them must
 * never stop somebody writing a post.
 */
async function loadHashtagProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
): Promise<HashtagProfile | null> {
  const { data, error } = await supabase
    .from('profiles_setup')
    .select('brand_name, industry, target_audience, keywords')
    .eq('workspace_id', workspaceId)
    .maybeSingle<{
      brand_name: string | null
      industry: string | null
      target_audience: string | null
      keywords: string[] | null
    }>()

  if (error) {
    console.error('[posts] brand profile unreadable: %s', error.message)
    return null
  }

  if (!data) return null

  return {
    brandName: data.brand_name,
    industry: data.industry,
    targetAudience: data.target_audience,
    keywords: data.keywords,
  }
}
