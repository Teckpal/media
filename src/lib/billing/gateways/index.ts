import 'server-only'

import { sslcommerzGateway } from '@/lib/billing/gateways/sslcommerz'
import { globalStubGateway } from '@/lib/billing/gateways/global-stub'
import type { PaymentGateway } from '@/lib/billing/gateways/types'
import type { BillingRegion } from '@/lib/constants'
import type { PaymentGatewayEnum } from '@/types/database'

/**
 * Region decides gateway, and nothing else does.
 *
 * This is also how Section 7A.2 rule 3 — "the payment method has the final
 * word on region" — is actually implemented. SSLCommerz only accepts
 * Bangladeshi cards and wallets; the global gateway only accepts
 * international ones. So the gateway that successfully took the money *is* the
 * evidence of which region the customer is in, and the region can be locked
 * from it without asking anyone to prove where they live.
 */
const BY_REGION: Record<BillingRegion, PaymentGateway> = {
  bd: sslcommerzGateway,
  global: globalStubGateway,
}

export function gatewayForRegion(region: BillingRegion): PaymentGateway {
  return BY_REGION[region]
}

/** For the webhook routes, which are addressed by gateway rather than region. */
export function gatewayById(id: PaymentGatewayEnum): PaymentGateway | null {
  for (const gateway of Object.values(BY_REGION)) {
    if (gateway.id === id) return gateway
  }
  return null
}

/** Can this region take money today? The paywall asks before offering a button. */
export function regionCanCheckout(region: BillingRegion): boolean {
  return BY_REGION[region].isConfigured()
}
