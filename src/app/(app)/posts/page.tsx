import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { StatusBadge } from '@/components/posts/status-badge'
import { PostBoard, type BoardPost } from '@/components/posts/post-board'
import { Alert } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { buttonStyles } from '@/components/ui/button'
import { requireWorkspace } from '@/lib/auth/gate'
import { createClient } from '@/lib/supabase/server'
import { formatDateTimeInZone } from '@/lib/time'
import { POST_STATUSES, atLeast, type Platform, type PostStatus } from '@/lib/constants'
import { ROUTES } from '@/lib/routes'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Posts' }

/**
 * Section 6.2: a removed post is hidden from the UI and kept in the audit log.
 * So `removed` is not one of the filters, and the default view excludes it.
 */
const FILTERS: { key: string; label: string; statuses: PostStatus[] }[] = [
  {
    key: 'all',
    label: 'All',
    statuses: POST_STATUSES.filter((s) => s !== 'removed'),
  },
  { key: 'draft', label: 'Drafts', statuses: ['draft'] },
  { key: 'scheduled', label: 'Scheduled', statuses: ['scheduled', 'pending_approval'] },
  { key: 'paused', label: 'Paused', statuses: ['paused'] },
  { key: 'published', label: 'Published', statuses: ['published'] },
  { key: 'failed', label: 'Needs attention', statuses: ['failed'] },
]

export default async function PostsPage({ searchParams }: PageProps<'/posts'>) {
  const { active } = await requireWorkspace()
  const params = await searchParams

  const filterKey = typeof params.filter === 'string' ? params.filter : 'all'
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0]
  const forbidden = params.error === 'forbidden'

  /**
   * The board ignores the filter, deliberately.
   *
   * Its whole value is the shape of all six columns side by side — a board
   * showing only drafts is a list with extra chrome. So the filter chips are
   * hidden in board view rather than quietly narrowing it.
   */
  const view: 'list' | 'board' = params.view === 'board' ? 'board' : 'list'

  const supabase = await createClient()
  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('id, status, caption, scheduled_at, published_at, updated_at, post_targets(platform)')
    .eq('workspace_id', active.workspace.id)
    .in('status', view === 'board' ? POST_STATUSES.filter((s) => s !== 'removed') : filter.statuses)
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(view === 'board' ? 200 : 100)
    .returns<
      {
        id: string
        status: PostStatus
        caption: string
        scheduled_at: string | null
        published_at: string | null
        updated_at: string
        post_targets: { platform: Platform }[] | null
      }[]
    >()

  // Bound and surfaced: an unreadable list and an empty one look the same
  // otherwise, and only one of them is a fact.
  if (postsError) throw new Error(`Could not read the posts: ${postsError.message}`)

  const rows = posts ?? []

  const boardPosts: BoardPost[] = rows.map((post) => ({
    id: post.id,
    caption: post.caption,
    status: post.status,
    when: post.published_at
      ? formatDateTimeInZone(post.published_at, active.workspace.timezone)
      : post.scheduled_at
        ? formatDateTimeInZone(post.scheduled_at, active.workspace.timezone)
        : null,
    platforms: [...new Set((post.post_targets ?? []).map((t) => t.platform))],
  }))
  const canWrite = atLeast(active.role, 'editor')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Posts</h1>
          <p className="text-sm text-muted-foreground">
            Times in {active.workspace.timezone}.
          </p>
        </div>

        {canWrite ? (
          <Link href={`${ROUTES.posts}/new`} className={buttonStyles()}>
            <Plus className="size-4" aria-hidden />
            New post
          </Link>
        ) : null}
      </div>

      {forbidden ? (
        <Alert tone="danger" title="You do not have permission to do that">
          A viewer can read posts but not change them.
        </Alert>
      ) : null}

      <div
        className={cn(
          'flex flex-wrap items-center gap-3',
          // Nothing to balance against in board view, so the toggle sits where
          // it would anyway rather than across a gap.
          view === 'board' ? 'justify-end' : 'justify-between',
        )}
      >
        <nav className={cn('flex flex-wrap gap-1', view === 'board' && 'hidden')} aria-label="Filter posts">
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={option.key === 'all' ? ROUTES.posts : `${ROUTES.posts}?filter=${option.key}`}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm transition-colors',
              option.key === filter.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
            )}
            aria-current={option.key === filter.key ? 'page' : undefined}
          >
            {option.label}
          </Link>
          ))}
        </nav>

        <div className="inline-flex rounded-[var(--radius)] border border-border p-0.5">
          {(
            [
              { key: 'list', label: 'List', href: ROUTES.posts },
              { key: 'board', label: 'Board', href: `${ROUTES.posts}?view=board` },
            ] as const
          ).map((option) => (
            <Link
              key={option.key}
              href={option.href}
              aria-current={view === option.key ? 'page' : undefined}
              className={cn(
                'rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-sm transition-colors',
                view === option.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
              )}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      {view === 'board' ? (
        <PostBoard posts={boardPosts} canWrite={canWrite} />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            {filter.key === 'all'
              ? 'No posts yet.'
              : `Nothing ${filter.label.toLowerCase()} right now.`}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((post) => (
            <li key={post.id}>
              <Link
                href={`${ROUTES.posts}/${post.id}`}
                className="flex items-start gap-3 rounded-[var(--radius)] border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-muted"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {post.caption.trim() || (
                      <span className="text-muted-foreground">No caption yet</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {post.published_at
                      ? `Published ${formatDateTimeInZone(post.published_at, active.workspace.timezone)}`
                      : post.scheduled_at
                        ? `For ${formatDateTimeInZone(post.scheduled_at, active.workspace.timezone)}`
                        : `Edited ${formatDateTimeInZone(post.updated_at, active.workspace.timezone)}`}
                  </p>
                </div>

                <StatusBadge status={post.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
