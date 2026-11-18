/**
 * Display helpers with no data dependencies.
 *
 * Separate from the page queries so a card that only needs to turn `RETAIL_STORE`
 * into "Retail store" does not pull the database client into its module graph.
 */

/** "RETAIL_STORE" → "Retail store". The enum stays the source of truth. */
export function labelKind(value: string): string {
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "2030-09" → "Sep 2030", for a chart axis a person can read. */
export function labelMonth(month: string): string {
  const [year, m] = month.split('-');
  if (!year || !m) return month;
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
  return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** Short form for a dense axis: "Sep 26". */
export function labelMonthShort(month: string): string {
  const [year, m] = month.split('-');
  if (!year || !m) return month;
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
  return new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(date) + ` ${year.slice(2)}`;
}

/**
 * Whole days between today and a `YYYY-MM-DD` calendar date.
 *
 * Calendar arithmetic, in UTC, on the date columns the warranty vault stores — the
 * same basis `addMonths` uses, so a warranty never reads as expiring a day early.
 */
export function daysUntilIsoDate(isoDate: string, now: Date = new Date()): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/** "in 14 days" / "12 days ago", said about a calendar date rather than a moment. */
export function describeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/**
 * A venue, written once.
 *
 * Venue names in this product routinely carry their own locality — "Grand
 * Sahyadri — Koregaon Park", "Phoenix Viman Nagar" — so a screen that prints
 * `name, locality` says the place twice and reads as a bug. The locality is
 * appended only when the name does not already contain it.
 *
 * `ticketWhere` in `ticket-shape.ts` answers the neighbouring question for an
 * object whose *title* already names the venue; this one is for a line that
 * has no title to compare against.
 */
export function venueLine(venue: { name: string; locality?: string | null } | null | undefined): string | null {
  if (!venue) return null;
  const locality = venue.locality?.trim();
  if (!locality) return venue.name;
  return venue.name.includes(locality) ? venue.name : `${venue.name}, ${locality}`;
}
