'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { copyFor } from '@/lib/marketing/copy'
import {
  isBillingRegion,
  REGION_COOKIE,
  REGION_COOKIE_MAX_AGE,
} from '@/lib/region'

/**
 * Section 7A.2 rule 1: "Landing: country from IP, visitor may toggle."
 *
 * This is the toggle. It writes the same cookie the proxy seeds from the IP,
 * so an explicit choice outlives the guess — a Bangladeshi founder on a US VPN
 * picks once and stays picked.
 *
 * It changes nothing but the page being read. Rule 3 still holds: the payment
 * method decides the region that is actually billed, and no price is read from
 * this cookie anywhere.
 */
export async function chooseRegionAction(formData: FormData): Promise<void> {
  const requested = formData.get('region')

  // An unknown value is ignored rather than defaulted, so a crafted post
  // cannot set the cookie to something `readRegionHint` would later have to
  // interpret.
  if (!isBillingRegion(requested)) redirect('/')

  const store = await cookies()
  store.set(REGION_COOKIE, requested, {
    maxAge: REGION_COOKIE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
  })

  redirect(copyFor(requested).path)
}
