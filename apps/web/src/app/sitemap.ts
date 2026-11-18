/**
 * The public surface, listed for a crawler.
 *
 * Only pages that are genuinely public, genuinely indexable, and the same for
 * everybody. That rules out more than it includes, and the exclusions are the
 * interesting part:
 *
 *  · Every signed-in screen. They answer 404 to a crawler; listing them would
 *    be advertising a page that does not exist for the reader.
 *  · `/v/<ref>` — a verification verdict. Public so a stranger can check a
 *    credential, and about one person: a search index is the last place it
 *    belongs. There is no enumeration of references anywhere for the same
 *    reason.
 *  · `/offline`. Useful to a person with no connection, meaningless to a
 *    crawler that has one.
 *
 * The developer pages are listed individually rather than as one entry, because
 * they are the pages somebody searching for "verify a credential India API" is
 * actually looking for, and a reference nobody can find is a reference nobody
 * reads.
 *
 * `lastModified` is the deploy time rather than a per-page date. A fabricated
 * per-page timestamp is worse than an honest coarse one: it tells a crawler to
 * re-fetch pages that have not changed, and it stops meaning anything the first
 * time somebody forgets to update it.
 */
import type { MetadataRoute } from 'next';
import { canonicalOrigin } from '@/lib/site';

/** Path, and how much of the site's weight it should carry. */
const PUBLIC_PAGES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/verify', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/pricing', priority: 0.7, changeFrequency: 'monthly' },

  { path: '/developers', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/developers/verify', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/developers/api', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/developers/webhooks', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/developers/realtime', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/developers/errors', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/developers/architecture', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/developers/status', priority: 0.5, changeFrequency: 'weekly' },

  { path: '/sign-in', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/sign-up', priority: 0.4, changeFrequency: 'yearly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = canonicalOrigin();
  const lastModified = new Date();

  return PUBLIC_PAGES.map((page) => ({
    url: `${origin}${page.path}`,
    lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
