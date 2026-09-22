import 'server-only'

import { serverEnv } from '@/lib/env'
import {
  GatewayError,
  type CallbackClaim,
  type CheckoutSession,
  type PaymentGateway,
  type ValidatedPayment,
} from '@/lib/billing/gateways/types'
import type { BillingRegion } from '@/lib/constants'

/**
 * The global gateway, Section 13 Q6 — **still unanswered**.
 *
 * Paddle, Lemon Squeezy and Stripe are all plausible, and the choice is not
 * really a technical one: Paddle and Lemon Squeezy act as merchant of record
 * and handle worldwide sales tax, Stripe does not and leaves that with the
 * company. That is a decision for the founder and an accountant.
 *
 * So this refuses, clearly, rather than pretending. A stub that quietly
 * succeeded would be far worse than one that says "not yet": it would let a
 * workspace believe it had paid, lock its billing region (Section 7A.2 rule 4)
 * and hand it a publish gate that opens on nothing.
 *
 * When Q6 is answered, this file is replaced and nothing above it changes.
 */

const NOT_CHOSEN =
  'Card payments outside Bangladesh are not open yet. Talk to us and we will ' +
  'set you up directly.'

class GlobalStubGateway implements PaymentGateway {
  readonly id = 'stub' as const
  readonly region: BillingRegion = 'global'

  isConfigured(): boolean {
    // Never. `GLOBAL_GATEWAY_PROVIDER` naming a real provider is not the same
    // as an adapter for it existing, and claiming otherwise is how a paywall
    // ends up offering a button that cannot work.
    return false
  }

  async createCheckout(): Promise<CheckoutSession> {
    throw new GatewayError(
      NOT_CHOSEN,
      `global gateway is a stub (GLOBAL_GATEWAY_PROVIDER=${
        serverEnv().GLOBAL_GATEWAY_PROVIDER
      })`,
    )
  }

  readCallback(): CallbackClaim | null {
    return null
  }

  async validate(): Promise<ValidatedPayment> {
    throw new GatewayError(
      NOT_CHOSEN,
      'global gateway is a stub; there is nothing to validate against',
    )
  }
}

export const globalStubGateway = new GlobalStubGateway()
