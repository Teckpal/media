import { runPublishTick } from '@/lib/publish/worker'
import { isAuthorisedCron, unauthorised } from '@/lib/cron'

/**
 * Section 9: "Queue: due posts."
 *
 * Every minute, which is as fine-grained as a scheduled post needs to be —
 * a 9:00 post going out at 9:00:40 is on time, and a per-second queue would
 * cost sixty times as many invocations to say "nothing to do".
 *
 * The tick is bounded rather than exhaustive: it claims a batch, publishes it,
 * and leaves the rest for the next minute. That keeps one enormous backlog from
 * running an invocation past its ceiling and losing everything it had done.
 */
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return unauthorised()

  const summary = await runPublishTick()

  return Response.json({ ok: true, ...summary })
}
