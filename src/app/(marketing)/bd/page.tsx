import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { Landing } from '@/components/marketing/landing'
import { BD_COPY } from '@/lib/marketing/copy'
import { isSignedIn } from '@/lib/marketing/visitor'
import { REGION_COOKIE, readRegionHint } from '@/lib/region'

/** The Bangladesh landing page (Section 7A.1): taka prices, local payments. */
export const metadata: Metadata = {
  title: BD_COPY.metaTitle,
  description: BD_COPY.metaDescription,
  alternates: {
    canonical: '/bd',
    languages: { 'en-BD': '/bd', en: '/' },
  },
  openGraph: {
    title: `${BD_COPY.metaTitle} · motif Social`,
    description: BD_COPY.metaDescription,
    url: '/bd',
    type: 'website',
  },
}

export default async function BdLandingPage() {
  const [signedIn, cookieStore, headerList] = await Promise.all([
    isSignedIn(),
    cookies(),
    headers(),
  ])

  const hint = readRegionHint(
    cookieStore.get(REGION_COOKIE)?.value,
    headerList.get('x-vercel-ip-country'),
  )

  return (
    <Landing
      copy={BD_COPY}
      suggestOtherRegion={hint === 'global'}
      signedIn={signedIn}
    />
  )
}
