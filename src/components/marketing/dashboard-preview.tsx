import { Calendar, LayoutGrid } from 'lucide-react'
import type { PostStatusEnum } from '@/types/database'

/**
 * A still of the product, drawn rather than screenshotted.
 *
 * A screenshot of an empty dashboard sells nothing, and a screenshot of a full
 * one is somebody's real client work. This is markup, so it stays honest as the
 * product changes and carries no data that belongs to anyone.
 *
 * Only the two tabs that exist are shown. An Inbox and an Analytics tab would
 * be the easiest thing in the world to draw here and would be a promise the
 * software does not keep.
 */

const SAMPLE: { day: string; caption: string; status: Extract<PostStatusEnum, 'draft' | 'scheduled' | 'published'> }[] = [
  { day: 'Mon, 14 Apr', caption: 'New season, same good coffee', status: 'draft' },
  { day: 'Wed, 16 Apr', caption: 'Spring collection lands on Friday', status: 'scheduled' },
  { day: 'Fri, 18 Apr', caption: 'Better places ahead', status: 'published' },
]

const STATUS_STYLE: Record<string, string> = {
  draft: 'border-white/20 text-white/60',
  scheduled: 'border-[var(--gold)]/50 text-[var(--gold)]',
  published: 'border-emerald-400/50 text-emerald-300',
}

export function DashboardPreview() {
  return (
    <section className="bg-[var(--night-band)] pb-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[var(--night)] shadow-2xl">
          {/* --- chrome --- */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/10 px-5 py-3.5">
            <span className="text-sm font-medium text-white">motif Social</span>
            <nav className="flex items-center gap-5 text-sm">
              <span className="flex items-center gap-1.5 text-white">
                <LayoutGrid className="size-3.5" aria-hidden />
                Overview
              </span>
              <span className="flex items-center gap-1.5 text-white/40">
                <Calendar className="size-3.5" aria-hidden />
                Calendar
              </span>
            </nav>
          </div>

          <div className="p-5 sm:p-7">
            <p className="text-xs font-medium tracking-[0.14em] text-white/40 uppercase">
              Content calendar
            </p>

            <ul className="mt-4 divide-y divide-white/10 border-y border-white/10">
              {SAMPLE.map((post) => (
                <li key={post.caption} className="flex flex-wrap items-center gap-3 py-3.5">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-white/45">
                    {post.day}
                  </span>
                  <span className="flex-1 text-sm text-white/85">{post.caption}</span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] capitalize ${STATUS_STYLE[post.status]}`}
                  >
                    {post.status}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-5 text-xs text-white/35">
              An illustration, not a screenshot. Only the two screens that exist
              today are drawn here.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
