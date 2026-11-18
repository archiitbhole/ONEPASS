/**
 * Values that are safe to interpolate into a raw `sql` template.
 *
 * Drizzle's typed operators — `eq`, `gte`, `lt` — carry the column's type
 * mapper, so `gte(bookings.createdAt, someDate)` serialises correctly. A raw
 * `sql` template carries nothing: the driver receives a bare JavaScript Date,
 * has no idea it is meant to be a timestamptz, and fails with
 *
 *   TypeError: The "string" argument must be of type string … Received an
 *   instance of Date
 *
 * which is a long way from saying "you interpolated a Date". This module exists
 * so that error is not discovered a fourth time.
 *
 * Raw SQL is still the right tool for aggregate filters — `count(*) filter
 * (where …)` has no builder equivalent and is worth far more than the cost of
 * one helper. Use the typed operators in an ordinary `where`, and `ts()` inside
 * a template.
 */
import { sql } from 'drizzle-orm';

/** A timestamp for a raw `sql` template: ISO text with an explicit cast. */
export function ts(value: Date) {
  return sql`${value.toISOString()}::timestamptz`;
}

/** A date (no time) for a raw `sql` template. */
export function dateOnly(value: Date) {
  return sql`${value.toISOString().slice(0, 10)}::date`;
}
