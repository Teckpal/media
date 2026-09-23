import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { Landing } from '@/components/marketing/landing'
import { GLOBAL_COPY } from '@/lib/marketing/copy'
import { REGION_COOKIE, readRegionHint } from '@/lib/region'

/**
 * The Global landing page (Section 7A.1).
 *
 * `/` stays the Global page whoever is looking at it, and a visitor whose IP
 * says Bangladesh is *offered* `/bd` rather than sent there. Two reasons: a
 * URL that renders different content depending on where the reader sits is one
 * search engines index once and half the audience never sees, and an automatic
 * redirect is impossible to argue with when the guess is wrong.
 */
export const metadata: Metadata = {
  title: GLOBAL_COPY.metaTitle,
  description: GLOBAL_COPY.metaDescription,
  alternates: {
    canonical: '/',
    languages: { 'en-BD': '/bd', en: '/' },
  },
  openGraph: {
    title: `${GLOBAL_COPY.metaTitle} · motif Social`,
    description: GLOBAL_COPY.metaDescription,
    url: '/',
    type: 'website',
  },
}

export default async function GlobalLandingPage() {
  // The landing no longer behaves differently for a signed-in visitor: it
  // always offers Log in, and `/login` decides what to do with a session.
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])

  const hint = readRegionHint(
    cookieStore.get(REGION_COOKIE)?.value,
    headerList.get('x-vercel-ip-country'),
  )

  return (
    <Landing
      copy={GLOBAL_COPY}
      suggestOtherRegion={hint === 'bd'}
    />
  )
}
