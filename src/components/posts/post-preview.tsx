'use client'

import {
  Bookmark,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Share2,
  ThumbsUp,
  Globe,
  Play,
} from 'lucide-react'
import type { Platform } from '@/lib/constants'
import { cn } from '@/lib/utils'

/**
 * The post, as each network will render it.
 *
 * Not decoration. The things that go wrong with a cross-posted caption are all
 * things you cannot see in a textarea:
 *
 *  - **Truncation.** Facebook folds at a few hundred characters, LinkedIn at
 *    about two hundred, Instagram at around one hundred and twenty-five. A
 *    caption whose point arrives in the third sentence arrives below a "see
 *    more" nobody taps.
 *  - **Cropping.** Instagram's feed is square and X's card is landscape. The
 *    same photograph loses its top and bottom on one and its sides on the
 *    other.
 *  - **Shape.** A caption that reads as considered on LinkedIn reads as
 *    shouting on X, and the only way to notice is to see them side by side.
 *
 * The chrome is deliberately approximate — a sketch, not a forgery. It carries
 * the proportions and the fold, which is what changes a decision; it does not
 * claim to be the real thing, and nothing here fetches anything from a network
 * or uses anybody's trade dress beyond a recognisable arrangement of boxes.
 */

export type PreviewMedia = {
  id: string
  previewUrl: string | null
  mimeType: string
}

/** Where each network folds a caption, in characters. */
const FOLD: Record<Platform, number> = {
  facebook: 480,
  instagram: 125,
  linkedin: 210,
  twitter: 280,
  tiktok: 150,
  youtube: 100,
}

export function PostPreview({
  platform,
  accountName,
  caption,
  media,
}: {
  platform: Platform
  accountName: string
  caption: string
  media: PreviewMedia[]
}) {
  switch (platform) {
    case 'instagram':
      return <InstagramPreview accountName={accountName} caption={caption} media={media} />
    case 'twitter':
      return <XPreview accountName={accountName} caption={caption} media={media} />
    case 'linkedin':
      return <LinkedInPreview accountName={accountName} caption={caption} media={media} />
    case 'tiktok':
      return <TikTokPreview accountName={accountName} caption={caption} media={media} />
    case 'youtube':
      return <YouTubePreview accountName={accountName} caption={caption} media={media} />
    case 'facebook':
      return <FacebookPreview accountName={accountName} caption={caption} media={media} />
  }
}

// --- the networks ------------------------------------------------------------

function FacebookPreview({ accountName, caption, media }: Chrome) {
  return (
    <Shell>
      <Header accountName={accountName} subtitle="Just now" globe />
      <Caption text={caption} fold={FOLD.facebook} more="See more" className="px-3 pb-2" />
      <Media media={media} ratio="aspect-[1.91/1]" />
      <Actions
        items={[
          { icon: ThumbsUp, label: 'Like' },
          { icon: MessageCircle, label: 'Comment' },
          { icon: Share2, label: 'Share' },
        ]}
      />
    </Shell>
  )
}

function InstagramPreview({ accountName, caption, media }: Chrome) {
  return (
    <Shell>
      <Header accountName={accountName} subtitle={null} />

      {/* Square, because the feed is. A tall photograph loses its top and its
          bottom here and there is no way to know that from the uploader. */}
      <Media media={media} ratio="aspect-square" required="Instagram needs an image or video." />

      <div className="flex items-center gap-4 px-3 pt-2.5 text-muted-foreground">
        <Heart className="size-5" aria-hidden />
        <MessageCircle className="size-5" aria-hidden />
        <Send className="size-5" aria-hidden />
        <Bookmark className="ml-auto size-5" aria-hidden />
      </div>

      <div className="px-3 pt-2 pb-3 text-sm">
        <span className="mr-1.5 font-semibold">{handleOf(accountName)}</span>
        <CaptionText text={caption} fold={FOLD.instagram} more="… more" inline />
      </div>
    </Shell>
  )
}

function XPreview({ accountName, caption, media }: Chrome) {
  return (
    <Shell>
      <div className="flex gap-3 p-3">
        <Avatar accountName={accountName} />

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold">{accountName}</span>
            <span className="truncate text-muted-foreground">
              @{handleOf(accountName)} · now
            </span>
          </p>

          <div className="mt-0.5 text-sm">
            <CaptionText text={caption} fold={FOLD.twitter} more="Show more" />
          </div>

          <div className="mt-2 overflow-hidden rounded-[var(--radius)]">
            <Media media={media} ratio="aspect-[16/9]" bare />
          </div>

          <div className="mt-2.5 flex max-w-[16rem] justify-between text-muted-foreground">
            <MessageCircle className="size-4" aria-hidden />
            <Repeat2 className="size-4" aria-hidden />
            <Heart className="size-4" aria-hidden />
            <Share2 className="size-4" aria-hidden />
          </div>
        </div>
      </div>
    </Shell>
  )
}

function LinkedInPreview({ accountName, caption, media }: Chrome) {
  return (
    <Shell>
      <Header accountName={accountName} subtitle="Now · " globe />
      <Caption text={caption} fold={FOLD.linkedin} more="…see more" className="px-3 pb-2" />
      <Media media={media} ratio="aspect-[1.91/1]" />
      <Actions
        items={[
          { icon: ThumbsUp, label: 'Like' },
          { icon: MessageCircle, label: 'Comment' },
          { icon: Repeat2, label: 'Repost' },
          { icon: Send, label: 'Send' },
        ]}
      />
    </Shell>
  )
}

function TikTokPreview({ accountName, caption, media }: Chrome) {
  const hasVideo = media.some((m) => m.mimeType.startsWith('video/'))

  return (
    <Shell>
      {/* Vertical, and video only. The validator refuses an image here; the
          preview says so in the same breath rather than leaving the refusal to
          arrive at publish time. */}
      <div className="mx-auto w-[60%] py-3">
        <Media
          media={media}
          ratio="aspect-[9/16]"
          required={hasVideo ? undefined : 'TikTok needs a video.'}
        />
      </div>

      <div className="px-3 pb-3 text-sm">
        <p className="font-semibold">{handleOf(accountName)}</p>
        <CaptionText text={caption} fold={FOLD.tiktok} more="more" />
      </div>
    </Shell>
  )
}

function YouTubePreview({ accountName, caption, media }: Chrome) {
  const hasVideo = media.some((m) => m.mimeType.startsWith('video/'))
  const [title, ...rest] = caption.split('\n')

  return (
    <Shell>
      <Media
        media={media}
        ratio="aspect-[16/9]"
        required={hasVideo ? undefined : 'YouTube needs a video.'}
        overlay={<Play className="size-8 text-white/80" aria-hidden />}
      />

      <div className="flex gap-3 p-3">
        <Avatar accountName={accountName} />

        <div className="min-w-0 flex-1">
          {/* The first line becomes the title, which is the thing people see in
              a list of results. A caption written as one paragraph gets a title
              that is the whole paragraph, cut — worth seeing before it ships. */}
          <p className="line-clamp-2 text-sm font-medium">
            {title.trim() || <span className="text-muted-foreground">Untitled</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {accountName} · No views · Just now
          </p>
          {rest.length > 0 ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {rest.join(' ').trim()}
            </p>
          ) : null}
        </div>
      </div>
    </Shell>
  )
}

// --- the shared furniture ----------------------------------------------------

type Chrome = { accountName: string; caption: string; media: PreviewMedia[] }

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
      {children}
    </div>
  )
}

function Avatar({ accountName }: { accountName: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
    >
      {accountName.slice(0, 2).toUpperCase()}
    </span>
  )
}

function Header({
  accountName,
  subtitle,
  globe = false,
}: {
  accountName: string
  subtitle: string | null
  globe?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 p-3">
      <Avatar accountName={accountName} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{accountName}</p>
        {subtitle ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {subtitle}
            {globe ? <Globe className="size-3" aria-hidden /> : null}
          </p>
        ) : null}
      </div>

      <MoreHorizontal className="size-4 text-muted-foreground" aria-hidden />
    </div>
  )
}

function Caption({
  text,
  fold,
  more,
  className,
}: {
  text: string
  fold: number
  more: string
  className?: string
}) {
  if (!text.trim()) return null
  return (
    <div className={cn('text-sm', className)}>
      <CaptionText text={text} fold={fold} more={more} />
    </div>
  )
}

/**
 * The caption up to the fold, then the rest in grey.
 *
 * Showing the hidden part rather than hiding it, because the question being
 * answered is "what will they see before they tap", and an answer that simply
 * removed the rest would look like the caption had been truncated for real.
 */
function CaptionText({
  text,
  fold,
  more,
  inline = false,
}: {
  text: string
  fold: number
  more: string
  inline?: boolean
}) {
  if (!text.trim()) {
    return <span className="text-muted-foreground italic">No caption yet.</span>
  }

  if (text.length <= fold) {
    return <span className={cn('whitespace-pre-wrap', inline && 'inline')}>{text}</span>
  }

  return (
    <span className={cn('whitespace-pre-wrap', inline && 'inline')}>
      {text.slice(0, fold)}
      <span className="text-muted-foreground">
        {' '}
        {more}
      </span>
      <span className="text-muted-foreground/40">{text.slice(fold)}</span>
    </span>
  )
}

function Media({
  media,
  ratio,
  required,
  bare = false,
  overlay,
}: {
  media: PreviewMedia[]
  ratio: string
  /** Shown instead of the frame when this network cannot post without media. */
  required?: string
  bare?: boolean
  overlay?: React.ReactNode
}) {
  const first = media[0]

  if (!first) {
    if (!required) return null
    return (
      <div
        className={cn(
          'flex items-center justify-center border-y border-dashed border-border bg-surface-muted px-4 text-center text-xs text-muted-foreground',
          ratio,
        )}
      >
        {required}
      </div>
    )
  }

  const isVideo = first.mimeType.startsWith('video/')

  return (
    <div className={cn('relative overflow-hidden bg-surface-muted', ratio, bare && 'rounded-[var(--radius)]')}>
      {first.previewUrl ? (
        isVideo ? (
          // Muted and not autoplaying: a preview that starts making noise while
          // somebody is writing is a preview they close.
          <video src={first.previewUrl} className="size-full object-cover" muted playsInline />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={first.previewUrl} alt="" className="size-full object-cover" />
        )
      ) : (
        <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
          Uploading…
        </div>
      )}

      {overlay ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/25">
          {overlay}
        </span>
      ) : null}

      {media.length > 1 ? (
        <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
          1/{media.length}
        </span>
      ) : null}
    </div>
  )
}

function Actions({
  items,
}: {
  items: { icon: typeof ThumbsUp; label: string }[]
}) {
  return (
    <div className="flex items-center justify-around border-t border-border py-1.5 text-muted-foreground">
      {items.map(({ icon: Icon, label }) => (
        <span key={label} className="flex items-center gap-1.5 px-2 py-1 text-xs">
          <Icon className="size-4" aria-hidden />
          {label}
        </span>
      ))}
    </div>
  )
}

/** "Demo Brand Page" -> "demobrandpage". Close enough to read as a handle. */
function handleOf(accountName: string): string {
  return accountName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'account'
}

