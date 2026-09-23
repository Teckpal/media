'use client'

import { useMemo } from 'react'
import { Hash, Plus } from 'lucide-react'
import {
  hashtagBudget,
  suggestHashtags,
  type HashtagProfile,
} from '@/lib/posts/hashtags'
import type { Platform } from '@/lib/constants'
import { cn } from '@/lib/utils'

/**
 * Hashtags to add, under the caption.
 *
 * Suggestions, not decisions: every one is a button that appends a tag, and
 * nothing is added on the user's behalf. A composer that wrote tags into the
 * caption by itself would be a composer people stop trusting with the caption.
 *
 * The count matters as much as the list. The budget shown is the *strictest*
 * of the chosen platforms, because one caption goes to all of them — ten tags
 * is normal on Instagram and ruins the same post on X. Going over is allowed
 * and only said out loud; the server does not refuse it, and neither should
 * this.
 *
 * Recomputed on every keystroke, which is affordable because
 * `suggestHashtags` is pure string work over a caption — no request, no
 * provider, no key. See `lib/posts/hashtags.ts` for where the suggestions come
 * from and what they deliberately do not know.
 */
export function HashtagPicker({
  caption,
  platforms,
  profile,
  onAppend,
  disabled = false,
}: {
  caption: string
  platforms: Platform[]
  profile: HashtagProfile | null
  onAppend: (tag: string) => void
  disabled?: boolean
}) {
  const suggestions = useMemo(
    () => suggestHashtags({ caption, profile, platforms }),
    [caption, profile, platforms],
  )

  const budget = useMemo(() => hashtagBudget(platforms), [platforms])

  const used = useMemo(
    () => (caption.match(/#[\p{L}\p{N}\p{M}_]+/gu) ?? []).length,
    [caption],
  )

  const over = used > budget

  if (suggestions.length === 0 && used === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Hash className="size-3.5 text-muted-foreground" aria-hidden />
          Hashtags
        </p>

        <p className={cn('text-xs', over ? 'text-warning' : 'text-muted-foreground')}>
          {used} of about {budget}
          {platforms.length > 1 ? ' (the strictest platform you picked)' : null}
          {over ? ' — more than these platforms usually carry' : null}
        </p>
      </div>

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.tag}
              type="button"
              disabled={disabled}
              onClick={() => onAppend(suggestion.tag)}
              title={
                suggestion.source === 'brand'
                  ? 'From your workspace profile — worth carrying on most posts'
                  : 'From this caption'
              }
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                disabled
                  ? 'cursor-not-allowed border-border opacity-50'
                  : 'border-border hover:border-primary hover:text-primary',
                // Brand tags read as the steadier of the two, because they are.
                suggestion.source === 'brand' && 'bg-surface-muted',
              )}
            >
              <Plus className="size-3" aria-hidden />#{suggestion.tag}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Write a little more, or fill in your brand details in Settings, and
          suggestions will appear here.
        </p>
      )}
    </div>
  )
}
