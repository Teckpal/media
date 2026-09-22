import type { MetadataRoute } from 'next'
import { appUrl } from '@/lib/env'

/**
 * Only the pages a stranger should land on.
 *
 * Both regional landing pages are listed at the same priority: Section 7A.1
 * treats them as two front doors, not a page and its variant, and letting a
 * search engine decide which of the two to prefer is the point.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl()
  const lastModified = new Date()

  return [
    { url: `${base}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/bd`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/signup`, lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/login`, lastModified, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/legal/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/legal/terms`, lastModified, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
