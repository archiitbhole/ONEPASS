/**
 * What ONEPASS can honestly say about its own coverage.
 *
 * Discovery is the one screen where a number is a claim. "Restaurants near you"
 * implies a map of a city; what this product actually has is the venues its
 * partners have brought on, which on a young platform is a short list. So the
 * page prints the real totals and says they are the whole list — and this is
 * where those totals are counted, from the same rows the grid below is drawn
 * from rather than from anything cached or estimated.
 *
 * Counts only. The listing itself is `discoverVenues` in `_queries.ts`; nothing
 * here duplicates it.
 */
import { and, countDistinct, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { cities, venues } from '@/db/schema';

export interface Coverage {
  /** Active venues on the platform, ignoring whatever filter the page is showing. */
  venues: number;
  /** Distinct businesses those venues belong to. */
  businesses: number;
  /** Cities marked live, which is what the filter offers. */
  cities: number;
}

export async function platformCoverage(): Promise<Coverage> {
  const [venueRow] = await db
    .select({
      n: sql<number>`count(*)::int`,
      businesses: countDistinct(venues.organizationId),
    })
    .from(venues)
    .where(eq(venues.isActive, true));

  const [cityRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cities)
    .where(eq(cities.isLive, true));

  return {
    venues: Number(venueRow?.n ?? 0),
    businesses: Number(venueRow?.businesses ?? 0),
    cities: Number(cityRow?.n ?? 0),
  };
}

/**
 * The venue kinds that actually have a venue behind them, with how many.
 *
 * The filter offers these and nothing else, for the same reason the receipts
 * screen only offers categories somebody has bought in: a chip that can only
 * ever return an empty page is a chip that teaches a person the product is
 * empty.
 */
export async function venueKindCounts(citySlug?: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ kind: venues.kind, n: sql<number>`count(*)::int` })
    .from(venues)
    .leftJoin(cities, eq(cities.id, venues.cityId))
    .where(citySlug ? and(eq(venues.isActive, true), eq(cities.slug, citySlug)) : eq(venues.isActive, true))
    .groupBy(venues.kind);

  return new Map(rows.map((r) => [r.kind, Number(r.n)]));
}
