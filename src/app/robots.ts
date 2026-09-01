/**
 * src/app/robots.ts — robots.txt for the public marketing surface.
 *
 * Everything except the marketing pages is either a bearer capability
 * embedded in the URL (`/t/**` carries a table's QR token — the one thing a
 * search index must never be allowed to enumerate) or an authenticated
 * staff/API surface with nothing to offer a crawler. Disallowing them here is
 * defense in depth: each of those routes also sets its own `noindex`
 * response header or metadata, but a crawler that never fetches the URL
 * never gets the chance to read that header in the first place.
 */
import type { MetadataRoute } from 'next'

import { appUrl } from '@/lib/env'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/t/', '/admin', '/kitchen', '/waiter', '/api'],
    },
    sitemap: `${appUrl()}/sitemap.xml`,
  }
}
