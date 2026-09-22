// Pure, and imported with a relative path so the test runner can load it
// directly. Everything that decides *what happens next* after a publish lives
// here; everything that talks to Postgres or to Meta lives beside it.
import { MAX_PUBLISH_ATTEMPTS } from '../constants.ts'

/**
 * Section 4: "Publish worker → success → mark published; failure → retry ×N →
 * mark failed → notify."
 *
 * The interesting part is the word *retry*, because three different failures
 * hide behind it:
 *
 *   - Facebook returned a 500. Try again shortly; it will probably work.
 *   - The token was revoked. Trying again cannot work, and each attempt delays
 *     the notification that asks the user to reconnect.
 *   - The request timed out. It may have published. Trying again may publish it
 *     twice, which Section 6.2 treats as the failure that matters most.
 *
 * So a failure is not simply counted, it is classified.
 */

export type FailureFacts = {
  /** Attempts made so far, this one included — the claim increments it. */
  attempts: number
  maxAttempts?: number
  /** Would repeating the request plausibly succeed? */
  retryable: boolean
  /**
   * Is repeating it *safe*? False after an ambiguous failure that we could not
   * reconcile against the platform, where a retry might publish twice.
   */
  safeToRepeat: boolean
}

export type GiveUpReason = 'permanent' | 'exhausted' | 'unconfirmed'

export type FailureOutcome =
  | { kind: 'retry'; nextAttemptAt: Date; attemptsLeft: number }
  | { kind: 'fail'; because: GiveUpReason }

/** One minute, then three, then nine — capped. */
const BASE_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 15 * 60_000

/**
 * Exponential, with the attempt count 1-based.
 *
 * No jitter: attempts are already spread out by the minute the queue ticks on,
 * and a deterministic delay is one a support person can predict when a customer
 * asks why their post has not gone out yet.
 */
export function backoffMs(attempt: number): number {
  const safe = Math.max(1, Math.floor(attempt))
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 3 ** (safe - 1))
}

export function decideAfterFailure(
  facts: FailureFacts,
  now: Date = new Date(),
): FailureOutcome {
  const maxAttempts = facts.maxAttempts ?? MAX_PUBLISH_ATTEMPTS

  // Checked before the attempt count, so a revoked token is reported as what
  // it is instead of as "we tried three times".
  if (!facts.retryable) return { kind: 'fail', because: 'permanent' }

  // Section 6.2, double publish. When we cannot tell whether the last attempt
  // landed, we stop and say so. A post the user has to check by hand is a far
  // smaller problem than the same post going out twice to their audience.
  if (!facts.safeToRepeat) return { kind: 'fail', because: 'unconfirmed' }

  const attemptsLeft = maxAttempts - facts.attempts
  if (attemptsLeft <= 0) return { kind: 'fail', because: 'exhausted' }

  return {
    kind: 'retry',
    nextAttemptAt: new Date(now.getTime() + backoffMs(facts.attempts)),
    attemptsLeft,
  }
}

/** What the user is told when the worker gives up. */
export function explainGivingUp(
  because: GiveUpReason,
  platformMessage: string,
): string {
  switch (because) {
    case 'permanent':
      return platformMessage
    case 'exhausted':
      return `${platformMessage} We tried ${MAX_PUBLISH_ATTEMPTS} times.`
    case 'unconfirmed':
      // Deliberately not "it failed" — we do not know that.
      return (
        `${platformMessage} We could not confirm whether it went out, so we ` +
        'stopped rather than risk posting it twice. Check the account before retrying.'
      )
  }
}
