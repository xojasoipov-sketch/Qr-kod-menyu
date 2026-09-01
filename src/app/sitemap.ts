/**
 * src/app/sitemap.ts — sitemap.xml for the public marketing surface only.
 *
 * Every entry here is a static `(marketing)` route with zero data fetching
 * (docs/architecture/05-app-structure.md §2.2) — no restaurant, branch or
 * table ever appears. `/t/**` is a bearer capability, not content: listing a
 * QR token in a sitemap would hand it to every crawler and everyone who ever
 * reads the resulting search index, which is exactly the leak brief §14 and
 * §34.9-10 exist to prevent. Staff and API routes are equally excluded — a
 * sitemap is an index of pages the public should find, not a map of the app.
 */
import type { MetadataRoute } from 'next'

import { appUrl } from '@/lib/env'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl()
  const lastModified = new Date()

  return [
    { url: base, lastModified, changeFrequency: 'monthly', priority: 1 },
    { url: `${base}/demo`, lastModified, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/legal/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/terms`, lastModified, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
