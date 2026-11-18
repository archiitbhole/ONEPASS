/**
 * What a crawler is allowed to look at.
 *
 * Every private screen in ONEPASS already carries `robots: { index: false }` in
 * its metadata, which is the instruction that actually binds a well-behaved
 * crawler. This is the other half: the file every crawler asks for before it
 * asks for anything else, and the only place the answer can be given before a
 * page is fetched at all.
 *
 * The disallow list is not a security control and must not be read as one — a
 * `Disallow` is a request, and publishing one tells anybody reading the file
 * exactly which paths exist. That is fine here because none of these paths are
 * secret: `/control` and `/business` are advertised on the landing page. What
 * keeps them shut is `authorize()` answering 404 to anyone without a
 * membership, and that is true whether or not a crawler is polite.
 *
 * What this genuinely buys:
 *  · a crawler does not spend its budget on screens that answer 404 to it;
 *  · a personal URL a customer pasted somewhere does not end up in an index;
 *  · `/api/` is not walked, which is otherwise a slow, pointless load.
 */
import type { MetadataRoute } from 'next';
import { canonicalOrigin } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          // Signed-in surfaces. All of them 404 to a crawler anyway; this saves
          // it the request.
          '/home',
          '/pass',
          '/profile',
          '/tickets',
          '/bookings',
          '/receipts',
          '/wallet',
          '/savings',
          '/warranties',
          '/returns',
          '/gifts',
          '/split',
          '/plan',
          '/travel',
          '/help',
          '/city-pass',
          '/explore',
          '/explore-quests',
          '/business/',
          '/control',
          // A verification verdict is about one credential and one person. It
          // is public so a stranger can check it, and it has no business in a
          // search index.
          '/v/',
          // Useful to a person with no connection; meaningless to a crawler.
          '/offline',
        ],
      },
    ],
    sitemap: `${canonicalOrigin()}/sitemap.xml`,
    host: canonicalOrigin(),
  };
}
