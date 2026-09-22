import { runNotificationTick } from '@/lib/notifications/dispatch'
import { isAuthorisedCron, unauthorised } from '@/lib/cron'

/**
 * Section 11: the email half of notifications.
 *
 * Every five minutes. A notification is not a publish — nothing is late at
 * 9:00:40 — and five minutes keeps the invocation count sensible while still
 * meaning a failed post is in somebody's inbox before they would have noticed
 * it themselves.
 */
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return unauthorised()

  const summary = await runNotificationTick()

  return Response.json({ ok: true, ...summary })
}
