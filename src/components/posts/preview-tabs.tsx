'use client'

import { useMemo, useState } from 'react'
import { Eye, Pencil } from 'lucide-react'
import { PostPreview, type PreviewMedia } from '@/components/posts/post-preview'
import { PlatformIcon } from '@/components/posts/platform-icon'
import { Textarea } from '@/components/ui/textarea'
import { PLATFORMS, PLATFORM_LABELS, type Platform } from '@/lib/constants'
import { cn } from '@/lib/utils'

/**
 * The post as each platform will render it, one at a time.
 *
 * ### Every platform is on the toggle, not only the chosen ones
 *
 * It used to list the platforms the post was going to, and hide the row
 * entirely when that was one. That answered "show me what I am posting" and
 * refused the question people actually ask, which is "what would this look
 * like on Instagram" — asked *before* deciding whether to post there.
 *
 * So all six are offered. The ones this post is going to are lit; the rest are
 * dimmed and say plainly, in the preview itself, that nothing is going there.
 * Nothing about the post changes by looking at it — the toggle is a lens, not
 * a target picker, and the accounts above remain the only thing that decides
 * where a post goes.
 *
 * ### The caption is editable here
 *
 * Because this is where its problems are visible. A caption whose point falls
 * past Instagram's fold is not a fact you can see in a textarea; it is a fact
 * you can see here, at the fold, with the hidden tail greyed out behind it.
 * Editing where the problem is beats reading a number and going elsewhere to
 * act on it.
 *
 * There is one caption, shared by every platform, so an edit made under the X
 * tab is the same edit everywhere. That is the data model, not a shortcut, and
 * the panel says so while you are typing.
 */

export type PreviewTarget = {
  id: string
  platform: Platform
  name: string
}

/** Tighter first: the version most likely to be a problem opens by default. */
const SEVERITY: Record<Platform, number> = {
  youtube: 0,
  instagram: 1,
  tiktok: 2,
  linkedin: 3,
  twitter: 4,
  facebook: 5,
}

export function PreviewTabs({
  targets,
  caption,
  media,
  onCaptionChange,
}: {
  targets: PreviewTarget[]
  caption: string
  media: PreviewMedia[]
  /** Absent on a locked post, which makes the preview read-only. */
  onCaptionChange?: (next: string) => void
}) {
  /** The first account chosen on each platform, for the name in the chrome. */
  const chosen = useMemo(() => {
    const byPlatform = new Map<Platform, PreviewTarget>()
    for (const target of targets) {
      if (!byPlatform.has(target.platform)) byPlatform.set(target.platform, target)
    }
    return byPlatform
  }, [targets])

  const order = useMemo(
    () =>
      [...PLATFORMS].sort((a, b) => {
        // Chosen platforms first, then by how hard each one crops or folds.
        const picked = Number(chosen.has(b)) - Number(chosen.has(a))
        return picked !== 0 ? picked : SEVERITY[a] - SEVERITY[b]
      }),
    [chosen],
  )

  const [active, setActive] = useState<Platform | null>(null)
  const [editing, setEditing] = useState(false)

  // Not held in state alone: the chosen platform can be deselected while this
  // is open, and the default has to follow what is actually selected now.
  const current = active ?? order[0]
  const target = chosen.get(current)
  const going = target !== undefined

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Eye className="size-3.5 text-muted-foreground" aria-hidden />
          Preview
        </p>

        {onCaptionChange ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[var(--radius)] px-2 py-1 text-xs transition-colors',
              editing
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground',
            )}
          >
            <Pencil className="size-3" aria-hidden />
            {editing ? 'Done' : 'Edit here'}
          </button>
        ) : null}
      </div>

      <div role="tablist" aria-label="Preview by platform" className="flex flex-wrap gap-1">
        {order.map((platform) => {
          const selected = platform === current
          const posting = chosen.has(platform)

          return (
            <button
              key={platform}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(platform)}
              title={posting ? undefined : `${PLATFORM_LABELS[platform]} — preview only`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--radius)] px-2.5 py-1.5 text-xs transition-colors',
                selected && 'bg-primary text-primary-foreground',
                !selected && posting && 'text-foreground hover:bg-surface-muted',
                // Dimmed rather than hidden: available to look at, obviously
                // not part of this post.
                !selected && !posting && 'text-muted-foreground/60 hover:bg-surface-muted',
              )}
            >
              <PlatformIcon platform={platform} />
              {PLATFORM_LABELS[platform]}
            </button>
          )
        })}
      </div>

      {/* Narrow on purpose. A feed is a column about this wide on every one of
          these networks, and a preview stretched to the width of a desktop
          composer folds in places the real thing never would. */}
      <div role="tabpanel" className="max-w-[26rem] space-y-2">
        {editing && onCaptionChange ? (
          <div className="space-y-1.5 rounded-[var(--radius)] border border-primary/40 bg-surface p-3">
            <Textarea
              value={caption}
              onChange={(e) => onCaptionChange(e.target.value)}
              rows={5}
              autoFocus
              placeholder="What do you want to say?"
            />
            <p className="text-[11px] text-muted-foreground">
              One caption, every platform — this is the same field as the one
              above. The preview below updates as you type.
            </p>
          </div>
        ) : null}

        <PostPreview
          platform={current}
          accountName={target?.name ?? `${PLATFORM_LABELS[current]} account`}
          caption={caption}
          media={media}
        />

        {going ? null : (
          <p className="text-xs text-muted-foreground">
            Preview only — this post is not going to {PLATFORM_LABELS[current]}.
            Tick an account above to send it there.
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        A sketch of the layout — the fold and the crop are real, the styling is
        approximate.
      </p>
    </div>
  )
}
