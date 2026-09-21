import { cn } from '@/lib/utils'
import type { PostStatus } from '@/lib/constants'

/**
 * The nine states from Section 6.2, in plain words.
 *
 * `removed` reads "removed here" rather than "deleted", because the post is
 * still live on the platform — the label is the last chance to say so.
 */
const LABELS: Record<PostStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  paused: 'Paused',
  failed: 'Failed',
  cancelled: 'Cancelled',
  removed: 'Removed here',
}

const TONES: Record<PostStatus, string> = {
  draft: 'bg-surface-muted text-muted-foreground',
  pending_approval: 'bg-warning-subtle text-foreground',
  scheduled: 'bg-primary/15 text-foreground',
  publishing: 'bg-primary text-primary-foreground',
  published: 'bg-success-subtle text-foreground',
  paused: 'bg-warning-subtle text-foreground',
  failed: 'bg-danger-subtle text-foreground',
  cancelled: 'bg-surface-muted text-muted-foreground line-through',
  removed: 'bg-surface-muted text-muted-foreground',
}

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[status],
      )}
    >
      {LABELS[status]}
    </span>
  )
}

export function statusLabel(status: PostStatus): string {
  return LABELS[status]
}
