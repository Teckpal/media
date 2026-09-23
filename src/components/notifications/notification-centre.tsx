'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, Check, X } from 'lucide-react'
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/lib/notifications/actions'
import { useLiveNotifications, type LiveNotification } from './use-live-notifications'
import { chimeMuted, primeChime, setChimeMuted } from '@/lib/notifications/chime'
import { EMPTY_FORM_STATE } from '@/lib/forms'
import { ROUTES } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * The bell, the panel behind it, and the toast that appears when something
 * happens.
 *
 * All three live in one component because they share one subscription. Split
 * apart they would each hold their own websocket and their own copy of the
 * list, and the toast would announce things the panel had already shown.
 *
 * The panel is an overlay, not a page. Somebody checking whether a post went
 * out is in the middle of doing something else; navigating away from it to
 * find out — and then having to navigate back — is the cost this removes.
 * `/notifications` still exists for the full history.
 */
/** How long the toast stays before it withdraws. */
const TOAST_MS = 8_000

export function NotificationCentre({
  workspaceId,
  userId,
  initialUnread,
}: {
  workspaceId: string
  userId: string
  /** From the server, so the badge is right before the subscription connects. */
  initialUnread: number
}) {
  const router = useRouter()
  const { items, unread, arrived, dismissArrived, markRead, markAllRead } =
    useLiveNotifications(workspaceId, userId)

  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // Until the subscription has loaded, the server's count is the honest one.
  const badge = items.length > 0 ? unread : initialUnread

  // The toast takes itself away. It is an interruption over somebody else's
  // work, so it gets a few seconds to be read and then stops covering the
  // corner — the panel still holds it, and the badge still counts it.
  useEffect(() => {
    if (!arrived) return
    const timer = window.setTimeout(dismissArrived, TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [arrived, dismissArrived])

  useEffect(() => {
    if (!open) return

    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function openNotification(item: LiveNotification) {
    markRead(item.id)
    setOpen(false)
    dismissArrived()

    // Marked read before navigating, not after: the destination is a different
    // page, and an await that never resolves because the route changed leaves
    // the badge wrong.
    const form = new FormData()
    form.set('notificationId', item.id)
    void markNotificationReadAction(EMPTY_FORM_STATE, form)

    if (item.link_path) router.push(item.link_path)
  }

  return (
    <>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          // The first gesture is what lets audio start at all, so the bell
          // doubles as permission to make a sound later.
          onPointerDown={primeChime}
          onClick={() => {
            // Read here rather than in an effect on mount. `localStorage` does
            // not exist on the server, so a render that consulted it would
            // disagree with the server's — and the toggle it feeds only exists
            // once the panel is open, so opening the panel is when the answer
            // is needed.
            setMuted(chimeMuted())
            setOpen((v) => !v)
          }}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={badge > 0 ? `Notifications, ${badge} unread` : 'Notifications'}
          className="relative inline-flex size-9 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <Bell className="size-4" aria-hidden />
          {badge > 0 ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground"
            >
              {badge > 9 ? '9+' : badge}
            </span>
          ) : null}
        </button>

        {open ? (
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Notifications"
            /* Portrait: tall and narrow, anchored under the bell. On a phone it
               is pinned to both edges instead, because a 22rem panel hanging
               off the right of a 360px screen is half off it. */
            className="fixed inset-x-3 top-16 z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-surface shadow-2xl sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:h-[28rem] sm:max-h-none sm:w-[22rem]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium">Notifications</h2>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const next = !muted
                    setMuted(next)
                    setChimeMuted(next)
                  }}
                  aria-pressed={muted}
                  aria-label={muted ? 'Turn the sound on' : 'Turn the sound off'}
                  title={muted ? 'Sound off' : 'Sound on'}
                  className="rounded-[var(--radius)] p-1.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  {muted ? <BellOff className="size-3.5" aria-hidden /> : <Bell className="size-3.5" aria-hidden />}
                </button>

                {unread > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      markAllRead()
                      void markAllNotificationsReadAction()
                    }}
                    className="inline-flex items-center gap-1 rounded-[var(--radius)] px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    <Check className="size-3.5" aria-hidden />
                    Mark all read
                  </button>
                ) : null}
              </div>
            </div>

            <ul className="flex-1 divide-y divide-border overflow-y-auto">
              {items.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nothing yet. Publishing results and billing notices arrive here.
                </li>
              ) : (
                items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openNotification(item)}
                      className={cn(
                        'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted',
                        !item.read && 'bg-primary/5',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          item.read ? 'bg-transparent' : 'bg-primary',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.title}</span>
                        {item.body ? (
                          <span className="mt-0.5 block text-xs text-pretty text-muted-foreground line-clamp-2">
                            {item.body}
                          </span>
                        ) : null}
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {relativeTime(item.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>

            <div className="border-t border-border px-4 py-2.5">
              <Link
                href={ROUTES.notifications}
                onClick={() => setOpen(false)}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                See everything
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      {/* --- the toast --- */}
      {arrived ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-3 bottom-3 z-50 w-[min(22rem,calc(100vw-1.5rem))] motif-toast rounded-[var(--radius)] border border-border bg-surface p-4 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15">
              <Bell className="size-3.5 text-primary" aria-hidden />
            </span>

            <button
              type="button"
              onClick={() => void openNotification(arrived)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block text-sm font-medium">{arrived.title}</span>
              {arrived.body ? (
                <span className="mt-0.5 block text-xs text-pretty text-muted-foreground line-clamp-2">
                  {arrived.body}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={dismissArrived}
              aria-label="Dismiss"
              className="rounded-[var(--radius)] p-1 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

/** "4m ago". Exact times belong on the full list, not in a glance. */
function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
