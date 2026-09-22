import { runBillingSweep } from '@/lib/billing/dunning'
import { isAuthorisedCron, unauthorised } from '@/lib/cron'

/**
 * Section 7.2's renewal cycle: raise, remind, grace, withdraw.
 *
 * Daily rather than hourly. Every deadline in Section 7.2 is measured in days,
 * and a sweep that ran more often would only find the same work not yet due —
 * while making the "have we already reminded them?" checks carry more weight
 * than they should.
 *
 * Idempotent throughout, because a cron that cannot safely run twice is a cron
 * that cannot safely be re-run after a failure.
 */
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return unauthorised()

  const summary = await runBillingSweep()

  return Response.json({ ok: true, ...summary })
}
