import type { MetadataRoute } from 'next'
import { appUrl } from '@/lib/env'

/**
 * Everything behind a sign-in is disallowed.
 *
 * Not for secrecy — those routes redirect an anonymous crawler anyway — but
 * because a crawler following them wastes its budget on redirects instead of
 * the two pages that are actually meant to be found. The API routes are listed
 * for the same reason.
 */
export default function robots(): MetadataRoute.Robots {
  const base = appUrl()

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/',
        '/dashboard',
        '/posts',
        '/calendar',
        '/connections',
        '/billing',
        '/notifications',
        '/settings',
        '/team',
        '/onboarding/',
        '/reconnect',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
