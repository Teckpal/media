import type { BillingRegion } from '@/lib/constants'

/**
 * Section 7A.2 — how region is decided.
 *
 *   1. Landing: country from IP (`x-vercel-ip-country`), visitor may toggle.
 *   2. Paywall: IP guess + country picked at signup.
 *   3. Final truth: the payment method actually used.
 *   4. After the first payment `billing_region` is locked on the workspace.
 *
 * Everything here answers (1) only. It is a display hint and nothing more —
 * no price is ever read from it. `resolvePrice` reads the DB by the locked
 * region, so a VPN gets a visitor a different landing page and nothing else.
 */

export const REGION_COOKIE = 'motif_region'
export const REGION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export function regionFromCountry(country: string | null | undefined): BillingRegion {
  return country?.toUpperCase() === 'BD' ? 'bd' : 'global'
}

export function isBillingRegion(value: unknown): value is BillingRegion {
  return value === 'bd' || value === 'global'
}

/** Reads the visitor's region hint: explicit toggle first, then IP. */
export function readRegionHint(
  cookieValue: string | undefined,
  ipCountry: string | null | undefined,
): BillingRegion {
  if (isBillingRegion(cookieValue)) return cookieValue
  return regionFromCountry(ipCountry)
}
