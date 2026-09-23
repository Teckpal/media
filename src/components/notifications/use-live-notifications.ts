'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { playChime } from '@/lib/notifications/chime'

/**
 * The workspace's notifications, kept current.
 *
 * Two mechanisms, deliberately:
 *
 *  - **Realtime** carries a row the moment it is written, which is what makes
 *    a post failing at nine in the morning visible at nine in the morning
 *    rather than on the next page load.
 *  - **A slow poll** runs anyway. Realtime is a websocket: it drops on a flaky
 *    connection, on a laptop lid closing, and on a project that has not
 *    enabled it — and a notification system that silently stops is worse than
 *    one that was never live, because nobody knows to look.
 *
 * The poll is the floor, not the mechanism. Sixty seconds is far too slow to
 * be the feature and far too cheap to matter as a backstop.
 */

export type LiveNotification = {
  id: string
  kind: string
  title: string
  body: string | null
  link_path: string | null
  created_at: string
  read: boolean
  /** Who caused it, where the writer recorded one. */
  actorId: string | null
}

/**
 * `data.actor_id`, when there is one.
 *
 * The column is free-form jsonb written by several modules, so this reads
 * defensively rather than casting: a notification whose `data` is a string, or
 * null, or an array must not throw on the way to the bell.
 */
function readActor(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const actor = (data as Record<string, unknown>).actor_id
  return typeof actor === 'string' ? actor : null
}

const POLL_MS = 60_000
const PAGE_SIZE = 20

export function useLiveNotifications(workspaceId: string, userId: string) {
  const [items, setItems] = useState<LiveNotification[]>([])
  const [arrived, setArrived] = useState<LiveNotification | null>(null)

  /** Ids already seen, so a poll that re-reads the list cannot re-announce it. */
  const known = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  const load = useCallback(
    async (announce: boolean) => {
      const supabase = createClient()

      // RLS decides what comes back: own notifications, plus the workspace's
      // unaddressed ones. The `read` flag is joined here rather than in SQL,
      // because PostgREST cannot express the anti-join and two small reads
      // beat a view nobody else needs.
      const [{ data: rows }, { data: reads }] = await Promise.all([
        supabase
          .from('notifications')
          .select('id, kind, title, body, link_path, created_at, data')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE),
        supabase.from('notification_reads').select('notification_id').eq('user_id', userId),
      ])

      if (!rows) return

      const readIds = new Set((reads ?? []).map((row) => row.notification_id))
      const next: LiveNotification[] = rows.map(({ data, ...row }) => ({
        ...row,
        read: readIds.has(row.id),
        actorId: readActor(data),
      }))

      // The first load defines "already here". Without this, every notification
      // in the list would announce itself on page load and chime several times
      // for things that happened yesterday.
      if (!primed.current) {
        for (const row of next) known.current.add(row.id)
        primed.current = true
        setItems(next)
        return
      }

      const fresh = next.filter((row) => !known.current.has(row.id) && !row.read)
      for (const row of next) known.current.add(row.id)

      setItems(next)

      // Your own click does not interrupt you.
      //
      // Now that every team action writes a notification, the person who just
      // pressed "Create invitation" would be told about the invitation they
      // are still looking at — with a chime. The row is still written, still
      // listed and still counted, because it is a record of what the team did;
      // it just does not announce itself to its own author.
      const forOthers = fresh.filter((row) => row.actorId !== userId)

      if (announce && forOthers.length > 0) {
        setArrived(forOthers[0])
        playChime()
      }
    },
    [workspaceId, userId],
  )

  useEffect(() => {
    const supabase = createClient()

    let channel: RealtimeChannel | null = null
    let cancelled = false

    void (async () => {
      await load(false)
      if (cancelled) return

      /**
       * The session token has to reach the realtime client BEFORE the join.
       *
       * MEASURED, not guessed. Subscribing straight away sent this frame:
       *
       *   phx_join {"config":{...,"postgres_changes":[{"event":"INSERT",...}]}}
       *
       * with no `access_token` in it, over a socket whose only credential is
       * the publishable key in the query string. The server answered
       * "Subscribed to PostgreSQL" and then delivered nothing, ever — because
       * Realtime evaluates `notifications_select_own` as whoever the socket
       * claims to be, and an anonymous socket can see no row in this table.
       * The failure is silent by construction: a correct subscription to
       * nothing looks exactly like a workspace where nothing has happened.
       *
       * supabase-js does call `setAuth` from its own auth listener, but that
       * fires after an async read of the session — which is to say after this
       * effect has already subscribed. So the token is fetched and installed
       * here first, and the channel is opened afterwards.
       */
      const { data } = await supabase.auth.getSession()
      if (cancelled) return

      await supabase.realtime.setAuth(data.session?.access_token ?? null)
      if (cancelled) return

      /**
       * A topic nobody else will claim.
       *
       * It was `notifications:<workspace id>`, which collides with itself:
       * React mounts an effect, tears it down and mounts it again in
       * development, so two channels asked for the same topic microseconds
       * apart and the first one's departure took the second's binding with it.
       * Nothing needs the name to be predictable — it identifies one
       * subscription to this client, not an address anybody sends to.
       */
      const topic = `notifications:${workspaceId}:${Math.random().toString(36).slice(2)}`

      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `workspace_id=eq.${workspaceId}`,
          },
          () => {
            // Re-read rather than trusting the payload. The payload bypasses
            // PostgREST, so re-reading keeps RLS the single answer to "may this
            // person see this" — and it costs one small query for an event that
            // happens a few times a day.
            void load(true)
          },
        )
        .subscribe((status, err) => {
          // Said out loud, because a websocket that never connects looks
          // exactly like a quiet workspace. The poll below keeps the feature
          // working either way, which is the point of having it — but a
          // permanently degraded channel should not be invisible while it does.
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[notifications] realtime %s%s', status, err ? `: ${err.message}` : '')
          }
        })
    })()

    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, POLL_MS)

    // Coming back to a tab that was asleep: catch up at once rather than
    // waiting out the poll.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [load, workspaceId])

  const dismissArrived = useCallback(() => setArrived(null), [])

  const markRead = useCallback((id: string) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read: true } : item)),
    )
  }, [])

  const markAllRead = useCallback(() => {
    setItems((current) => current.map((item) => ({ ...item, read: true })))
  }, [])

  return {
    items,
    unread: items.filter((item) => !item.read).length,
    arrived,
    dismissArrived,
    markRead,
    markAllRead,
  }
}
