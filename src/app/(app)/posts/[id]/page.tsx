import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Composer } from '../composer'
import { PostActions } from '../post-actions'
import { StatusBadge } from '@/components/posts/status-badge'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import { loadComposerMedia, loadTargetOptions } from '@/lib/posts/queries'
import { canPublish, explainBlock } from '@/lib/billing/entitlements'
import { formatDateTimeInZone, isPast, todayInZone, utcToLocalInput } from '@/lib/time'
import { LOCKED_STATUSES, PLATFORM_LABELS, atLeast, type Platform } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import type { HashtagProfile } from '@/lib/posts/hashtags'

export const metadata: Metadata = { title: 'Post' }

export default async function PostPage({
  params,
  searchParams,
}: PageProps<'/posts/[id]'>) {
  const { active } = await requireWorkspace()
  const { id } = await params
  const query = await searchParams

  const supabase = await createClient()

  // Scoped to the workspace, so an id from somewhere else is a 404 rather than
  // a permission error — which would confirm the post exists.
  const { data: post } = await supabase
    .from('posts')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', active.workspace.id)
    .maybeSingle()

  if (!post) notFound()

  const { data: targetRows } = await supabase
    .from('post_targets')
    .select('social_account_id, platform, status, last_error, external_permalink')
    .eq('post_id', post.id)
    .neq('status', 'cancelled')

  const targets = targetRows ?? []
  const [options, media] = await Promise.all([
    loadTargetOptions(active.workspace.id),
    loadComposerMedia(active.workspace.id, post.media_ids),
  ])

  const accountIds = targets.map((t) => t.social_account_id)
  const entitlement = await canPublish(active.workspace, accountIds)
  const profile = await loadHashtagProfile(supabase, active.workspace.id)

  const canWrite = atLeast(active.role, 'editor')
  const locked = LOCKED_STATUSES.includes(post.status)
  const finished = ['published', 'removed', 'cancelled'].includes(post.status)

  // Section 6.2, resume: if the moment has passed, a new time has to be picked
  // rather than quietly publishing late.
  const mustReschedule =
    query.reschedule === '1' ||
    (post.status === 'paused' && (!post.scheduled_at || isPast(post.scheduled_at)))

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href={ROUTES.posts}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All posts
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {finished ? 'Post' : 'Edit post'}
        </h1>
        <StatusBadge status={post.status} />
      </div>

      {query.saved === '1' ? <Alert tone="success">Saved.</Alert> : null}

      {post.status === 'publishing' ? (
        <Alert title="Going out now">
          This post is being published. It cannot be edited, paused or deleted
          while that is happening.
        </Alert>
      ) : null}

      {post.status === 'failed' && post.last_error ? (
        <Alert tone="danger" title="This post did not go out">
          {post.last_error}
        </Alert>
      ) : null}

      {/*
        Per-account progress, for a post that is still in the middle of its
        fan-out or that stopped part-way. A post can succeed on Facebook and
        fail on Instagram, and the roll-up on the post itself cannot say that.
      */}
      {['publishing', 'failed'].includes(post.status) && targets.length > 0 ? (
        <Card className="space-y-2">
          <h2 className="text-sm font-medium">Where it is going</h2>
          <ul className="space-y-1.5 text-sm">
            {targets.map((target) => (
              <li key={target.social_account_id}>
                <span className="text-muted-foreground">
                  {PLATFORM_LABELS[target.platform as Platform]} · {target.status}
                </span>
                {target.last_error ? (
                  <p className="text-xs text-danger">{target.last_error}</p>
                ) : null}
                {target.external_permalink ? (
                  <>
                    {' '}
                    <a
                      href={target.external_permalink}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary hover:underline"
                    >
                      View on the platform
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {post.status === 'pending_approval' ? (
        <Alert tone="warning" title="Waiting for approval">
          An admin or owner needs to approve this before it is scheduled.
        </Alert>
      ) : null}

      {finished ? (
        <Card className="space-y-3">
          <p className="text-sm whitespace-pre-wrap">
            {post.caption || (
              <span className="text-muted-foreground">No caption</span>
            )}
          </p>

          {post.published_at ? (
            <p className="text-xs text-muted-foreground">
              Published {formatDateTimeInZone(post.published_at, active.workspace.timezone)}
            </p>
          ) : null}

          <ul className="space-y-1 text-sm">
            {targets.map((target) => (
              <li key={target.social_account_id} className="text-muted-foreground">
                {PLATFORM_LABELS[target.platform as Platform]} · {target.status}
                {target.external_permalink ? (
                  <>
                    {' · '}
                    <a
                      href={target.external_permalink}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary hover:underline"
                    >
                      View on the platform
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>

          {post.status === 'removed' ? (
            <Alert>
              This post was removed from motif Social. It is still live on the
              platform.
            </Alert>
          ) : null}
        </Card>
      ) : (
        <Composer
          workspaceId={active.workspace.id}
          timezone={active.workspace.timezone}
          targets={options}
          defaults={{
            postId: post.id,
            caption: post.caption,
            media,
            accountIds,
            scheduledLocal: post.scheduled_at
              ? utcToLocalInput(post.scheduled_at, active.workspace.timezone)
              : '',
          }}
          locked={locked || !canWrite}
          canSchedule={entitlement.allowed}
          scheduleBlockReason={entitlement.allowed ? null : explainBlock(entitlement.block)}
          mustReschedule={mustReschedule}
          today={todayInZone(active.workspace.timezone)}
          profile={profile}
        />
      )}

      {canWrite ? (
        <div className="border-t border-border pt-5">
          <PostActions
            postId={post.id}
            status={post.status}
            platforms={targets.map((t) => t.platform as Platform)}
          />
        </div>
      ) : null}
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
