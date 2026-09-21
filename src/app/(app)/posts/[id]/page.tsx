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
import { formatDateTimeInZone, isPast, utcToLocalInput } from '@/lib/time'
import { LOCKED_STATUSES, PLATFORM_LABELS, atLeast, type Platform } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'

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

  const canWrite = atLeast(active.role, 'editor')
  const locked = LOCKED_STATUSES.includes(post.status)
  const finished = ['published', 'removed', 'cancelled'].includes(post.status)

  // Section 6.2, resume: if the moment has passed, a new time has to be picked
  // rather than quietly publishing late.
  const mustReschedule =
    query.reschedule === '1' ||
    (post.status === 'paused' && (!post.scheduled_at || isPast(post.scheduled_at)))

  return (
    <div className="mx-auto max-w-2xl space-y-6">
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

      {post.status === 'failed' && post.last_error ? (
        <Alert tone="danger" title="This post did not go out">
          {post.last_error}
        </Alert>
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
