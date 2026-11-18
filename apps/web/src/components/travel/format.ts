/**
 * How travel figures are written, in one place.
 *
 * A duration, a route, a cabin and a fare index appear on a dozen screens each,
 * and the cost of formatting them at each site is not the duplication — it is
 * that they drift. One screen says "2h 35m", another "2 hr 35 min", a third
 * rounds to "2.6h", and a customer comparing two of them cannot tell whether
 * the flights differ or the pages do.
 *
 * Everything here is pure and has no database and no React in it, so it can be
 * used from a server component, a client component and a test alike.
 */
import type { Cabin } from '@/lib/travel/providers/types';

const CABIN_LABELS: Record<Cabin, string> = {
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'Premium economy',
  BUSINESS: 'Business',
  FIRST: 'First',
};

export function cabinLabel(cabin: Cabin): string {
  return CABIN_LABELS[cabin];
}

/** `155` → `2h 35m`. Minutes only under an hour, so "0h 45m" never appears. */
export function duration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** The clock time at the airport, not the reader's — a departure is local. */
export function clock(at: Date, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(at);
}

export function dayLabel(at: Date, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(at);
}

/** `YYYY-MM-DD` in India, for a date input and for a query parameter. */
export function dateInput(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
}

/**
 * How many days later the arrival is.
 *
 * Returns 0, 1 or 2 — rendered as the `+1` beside an arrival time. Getting this
 * wrong is how a red-eye looks like it lands before it takes off.
 */
export function dayOffset(departAt: Date, arriveAt: Date, timeZone = 'Asia/Kolkata'): number {
  const day = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
  const from = Date.parse(`${day(departAt)}T00:00:00Z`);
  const to = Date.parse(`${day(arriveAt)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function stopsLabel(stops: number): string {
  if (stops <= 0) return 'Nonstop';
  if (stops === 1) return '1 stop';
  return `${stops} stops`;
}

/** A tone for the fare index, so the same number never reads two ways. */
export function indexTone(index: number | null): 'ok' | 'neutral' | 'warn' | 'bad' {
  if (index === null) return 'neutral';
  if (index <= 90) return 'ok';
  if (index < 110) return 'neutral';
  if (index < 125) return 'warn';
  return 'bad';
}

/**
 * A percentage difference, written as a person would say it.
 *
 * `-18` → "18% below", `0` → "the same". Never "-18%", which reads as a
 * discount on a page full of discounts.
 */
export function comparison(percent: number | null): string {
  if (percent === null) return 'not enough data';
  if (percent === 0) return 'the same';
  return `${Math.abs(percent)}% ${percent < 0 ? 'below' : 'above'}`;
}

/** Whole rupees, for a heading. The paise are never interesting in a fare. */
export function rupees(minor: number): string {
  return `₹${Math.round(minor / 100).toLocaleString('en-IN')}`;
}

/** Plain-language name for a booking state, aimed at a traveller. */
export const STATE_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  OFFER_SELECTED: 'neutral',
  REVALIDATING: 'info',
  PRICE_CONFIRMED: 'info',
  PAYMENT_PENDING: 'warn',
  PAYMENT_AUTHORIZED: 'info',
  BOOKING_PENDING: 'info',
  CONFIRMED: 'ok',
  TICKETED: 'ok',
  REVALIDATION_FAILED: 'warn',
  PRICE_CHANGED: 'warn',
  PAYMENT_FAILED: 'warn',
  BOOKING_FAILED: 'bad',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
};

export const STATE_LABEL: Record<string, string> = {
  OFFER_SELECTED: 'Not booked',
  REVALIDATING: 'Checking',
  PRICE_CONFIRMED: 'Price confirmed',
  PAYMENT_PENDING: 'Awaiting payment',
  PAYMENT_AUTHORIZED: 'Paid',
  BOOKING_PENDING: 'Booking',
  CONFIRMED: 'Confirmed',
  TICKETED: 'Ticketed',
  REVALIDATION_FAILED: 'Fare gone',
  PRICE_CHANGED: 'Price changed',
  PAYMENT_FAILED: 'Payment failed',
  BOOKING_FAILED: 'Not confirmed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

/**
 * Which part of the day a flight leaves in, at the airport it leaves from.
 *
 * Three bands rather than six, because the question a person is answering is
 * "can I get there in the morning" and not "does it leave at 09:40". The hour
 * is read in India's time zone for the same reason `clock` is: a departure is
 * local to the airport, never to the reader.
 */
export type DepartureBand = 'am' | 'pm' | 'eve';

export const BAND_LABEL: Record<DepartureBand, string> = {
  am: 'Before noon',
  pm: 'Noon to 6pm',
  eve: 'After 6pm',
};

export function departureBand(at: Date, timeZone = 'Asia/Kolkata'): DepartureBand {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(at),
  );
  if (hour < 12) return 'am';
  if (hour < 18) return 'pm';
  return 'eve';
}
