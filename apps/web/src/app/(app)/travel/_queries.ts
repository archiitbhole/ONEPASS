/**
 * The reads the travel screens share.
 *
 * Kept out of the pages for the reason the rest of this app does it: a page is
 * a layout, and a page that also builds its own queries ends up with two
 * concerns and a growing temptation to fetch inside a loop. Every function here
 * takes what it needs and returns plain data.
 */
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { airlines, airports, bankOffers } from '@/db/schema';

export interface AirportOption {
  code: string;
  name: string;
  city: string;
  cityCode: string | null;
  country: string;
  isDomestic: boolean;
  /**
   * Where the airport is. Nullable because the column is: an airport seeded
   * without coordinates gets no drawn route rather than a drawn guess.
   */
  latitude: string | null;
  longitude: string | null;
}

/**
 * Every airport, for the two pickers on the search form.
 *
 * All of them, in one query, rather than a search-as-you-type endpoint. There
 * are a few dozen: shipping the list means the picker works with no network at
 * all, which matters on a phone on a train, and it removes a whole endpoint's
 * worth of rate limiting and abuse surface. If this ever grows to thousands it
 * becomes a server-side search, and that is the moment to change it — not before.
 */
export async function listAirports(): Promise<AirportOption[]> {
  const rows = await db
    .select({
      code: airports.code,
      name: airports.name,
      city: airports.city,
      cityCode: airports.cityCode,
      country: airports.country,
      isDomestic: airports.isDomestic,
      latitude: airports.latitude,
      longitude: airports.longitude,
    })
    .from(airports)
    .where(eq(airports.active, true))
    // Indian airports first, then alphabetically by city: the list is scanned by
    // city name, not by code, and the traffic this serves is domestic.
    .orderBy(desc(airports.isDomestic), asc(airports.city));

  return rows;
}

/** One airport, for a page that has a code and needs a name. */
export async function airportsByCode(codes: string[]): Promise<Map<string, AirportOption>> {
  const unique = [...new Set(codes.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({
      code: airports.code,
      name: airports.name,
      city: airports.city,
      cityCode: airports.cityCode,
      country: airports.country,
      isDomestic: airports.isDomestic,
      latitude: airports.latitude,
      longitude: airports.longitude,
    })
    .from(airports)
    .where(sql`${airports.code} in ${unique}`);

  return new Map(rows.map((row) => [row.code, row]));
}

/** Airline names by code, so a results page never renders a bare `6E`. */
export async function airlineNames(): Promise<Map<string, string>> {
  const rows = await db.select({ code: airlines.code, name: airlines.name }).from(airlines);
  return new Map(rows.map((row) => [row.code, row.name]));
}

export async function airlineDetails(): Promise<Map<string, { name: string; isLowCost: boolean }>> {
  const rows = await db
    .select({ code: airlines.code, name: airlines.name, isLowCost: airlines.isLowCost })
    .from(airlines);
  return new Map(rows.map((row) => [row.code, { name: row.name, isLowCost: row.isLowCost }]));
}

/**
 * Airports matching a typed phrase.
 *
 * Used by the AirIndex route explorer, where the list is a filter rather than a
 * picker. Matches the code, the city and the airport's own name, because people
 * reach for all three.
 */
export async function findAirports(query: string, limit = 12): Promise<AirportOption[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const like = `%${trimmed}%`;
  return db
    .select({
      code: airports.code,
      name: airports.name,
      city: airports.city,
      cityCode: airports.cityCode,
      country: airports.country,
      isDomestic: airports.isDomestic,
      latitude: airports.latitude,
      longitude: airports.longitude,
    })
    .from(airports)
    .where(
      or(
        ilike(airports.code, trimmed.length === 3 ? trimmed : like),
        ilike(airports.city, like),
        ilike(airports.name, like),
      ),
    )
    .orderBy(desc(airports.isDomestic), asc(airports.city))
    .limit(limit);
}

/**
 * How many bank offers are actually running right now.
 *
 * The hub shows this as a count rather than a list, and the count has to mean
 * the same thing the discounts page means by "running now" — active, started,
 * not yet ended. Computed in the database rather than by fetching every offer
 * and filtering in JavaScript, because a count is a count.
 */
export async function liveBankOfferCount(now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(bankOffers)
    .where(and(eq(bankOffers.active, true), lte(bankOffers.startsAt, now), gte(bankOffers.endsAt, now)));
  return row?.n ?? 0;
}
