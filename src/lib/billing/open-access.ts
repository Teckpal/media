/**
 * The switch that makes the whole product free.
 *
 * Section 7.1 is blunt — "scheduling and publishing are fully paid, no free
 * tier" — and the gates that enforce it are the ones with the most careful
 * tests in the codebase, because being wrong about them means publishing for
 * somebody who has not paid. None of that is being deleted. This is one flag
 * that says "not yet", read in one place, and turned off by removing a line
 * from the environment.
 *
 * ### Why a flag rather than editing the rules
 *
 * The alternative offered itself: loosen `decideEntitlement`, set every
 * workspace's `is_billing_exempt`, or comment out the calls. Each of those
 * loses the rule. A flag keeps the rule intact and dated — and when it comes
 * off, the gates are already written, already tested, and already in the call
 * path. Nothing has to be remembered and re-implemented.
 *
 * ### Why it defaults to closed
 *
 * `OPEN_ACCESS` unset means the gates apply. A paywall bypass that defaults to
 * on is a paywall bypass that reaches production, because nothing ever fails
 * to remind you. It is set in `.env.local` for development; a deployment that
 * wants it has to say so.
 *
 * ### What it opens
 *
 *  - **Gate 2**, the publish gate: any connected account may be scheduled and
 *    published to, paid seat or not.
 *  - **Gate 1's connection requirement**: the dashboard is reachable before
 *    anything has been connected. Not the rest of gate 1 — a signed-out or
 *    unverified visitor is still turned away, because that is authentication,
 *    not commerce.
 *  - **The onboarding paywall**: the step passes through instead of asking for
 *    a card.
 *
 * It never opens anything to do with identity, ownership or roles. Section 6.3
 * is about who may act, not about who has paid, and this has no opinion on it.
 */
export function openAccess(): boolean {
  return process.env.OPEN_ACCESS === 'true'
}

/**
 * Said once per process, not once per request.
 *
 * A free product is a state somebody should be able to discover from the logs
 * rather than by wondering why the paywall never appears. Rate-limited to the
 * first call so it does not drown the request log it is meant to inform.
 */
let announced = false

export function noteOpenAccess(): void {
  if (announced || !openAccess()) return
  announced = true
  console.warn(
    '[billing] OPEN_ACCESS is on: the publish gate, the connection gate and the paywall are bypassed.',
  )
}
