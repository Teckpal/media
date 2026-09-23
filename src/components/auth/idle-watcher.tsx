'use client'

import { useEffect, useRef } from 'react'
import { IDLE_LIMIT_MS, TOUCH_INTERVAL_MS } from '@/lib/auth/idle'

/**
 * The browser's half of the idle timeout.
 *
 * It does two things, and neither of them is the rule itself — the proxy holds
 * that, because a timer in a tab is a request rather than an enforcement.
 *
 *  1. **Keeps a working session alive.** The server's clock is refreshed by
 *     requests, and somebody writing a long post makes none. Without this they
 *     would be signed out mid-sentence at thirty minutes and lose the draft.
 *     A ping goes out at most every five minutes, and only if they have
 *     actually done something since the last one.
 *
 *  2. **Tells them promptly.** At the limit it reloads, which the proxy turns
 *     into the login page. Otherwise an abandoned screen sits there looking
 *     signed in until somebody clicks, and the click is what fails.
 *
 * Nothing here is trusted. A browser that never runs it is simply signed out
 * on its next request, which is the correct outcome.
 */
export function IdleWatcher() {
  // Zeroed, not `Date.now()`: reading the clock during render is impure, and
  // the effect below sets the real starting point the moment it mounts.
  const state = useRef({ lastActivity: 0, lastTouch: 0, stopped: false })

  useEffect(() => {
    const s = state.current
    s.lastActivity = Date.now()
    s.lastTouch = s.lastActivity
    s.stopped = false

    const markActive = () => {
      s.lastActivity = Date.now()
    }

    // `passive` on all of them: none of this blocks or cancels anything, and
    // saying so keeps scrolling smooth.
    const events = ['pointerdown', 'keydown', 'scroll', 'focus'] as const
    for (const event of events) {
      window.addEventListener(event, markActive, { passive: true })
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      markActive()
      // Coming back to a tab that sat idle past the limit: find out now rather
      // than on the next click.
      if (Date.now() - s.lastActivity > IDLE_LIMIT_MS) window.location.reload()
    }
    document.addEventListener('visibilitychange', onVisible)

    const tick = window.setInterval(() => {
      if (s.stopped) return
      const now = Date.now()
      const idleFor = now - s.lastActivity

      if (idleFor > IDLE_LIMIT_MS) {
        s.stopped = true
        // The proxy sees the stale cookie and sends them to sign in.
        window.location.reload()
        return
      }

      // Active since the last ping, and it has been a while: tell the server.
      const activeSinceTouch = s.lastActivity > s.lastTouch
      if (activeSinceTouch && now - s.lastTouch >= TOUCH_INTERVAL_MS) {
        s.lastTouch = now
        // `keepalive` so a ping started as the page unloads still lands.
        void fetch('/api/session/touch', { method: 'POST', keepalive: true }).catch(() => {
          // A failed ping is not worth reporting: the next request refreshes
          // the clock anyway, and the worst case is signing out on time.
        })
      }
    }, 30_000)

    return () => {
      s.stopped = true
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
      for (const event of events) window.removeEventListener(event, markActive)
    }
  }, [])

  return null
}
