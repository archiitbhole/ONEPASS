/**
 * Trips.
 *
 * Every flight booking, and the trips the planner built, on one timeline —
 * because a person on a journey does not think of "my flight" and "my itinerary"
 * as two products, and ONEPASS has one planner rather than two.
 *
 * Upcoming flights are drawn as the boarding passes they are: a shelf of things
 * you are holding, each one openable. History is a ledger instead — a flown or
 * cancelled booking is a record, and a record does not need to be the size of a
 * boarding pass. That is the same distinction `/tickets` makes, and for the same
 * reason.
 *
 * Sorted by departure with the upcoming ones first, which is the only ordering
 * anybody wants: a trip list ordered by when it was booked puts last year's
 * holiday above next week's flight.
 *
 * A booking that went wrong is shown *more* prominently rather than less, at the
 * top, before anything else. The worst thing this list can do is let a
 * BOOKING_FAILED sit quietly between two confirmed trips, because that is the
 * one row where somebody is owed money.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { itineraries } from '@/db/schema';
import {
  Badge,
  ButtonLink,
  Card,
  Empty,
  Money,
  Notice,
  PageHead,
  formatDate,
  formatRelative,
} from '@/components/ui';
import { BoardingPass } from '@/components/travel/boarding-pass';
import { STATE_LABEL, STATE_TONE, dayLabel } from '@/components/travel/format';
import { sourceSummary } from '@/components/travel/sources';
import { listBookings } from '@/lib/travel/booking';
import { currentActor } from '../../_queries';
import { airlineNames, airportsByCode } from '../_queries';

export const metadata: Metadata = {
  title: 'Your trips',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { done, error } = await searchParams;
  const actor = await currentActor();
  const sources = sourceSummary();

  const bookings = await listBookings(actor.userId, 100);
  const [airlines, places] = await Promise.all([
    airlineNames(),
    airportsByCode(bookings.flatMap((booking) => [booking.originCode, booking.destinationCode])),
  ]);

  // Trips the planner built. Only journeys and multi-day trips — a single day's
  // plan is not a trip and lives on /plan.
  const journeys = await db
    .select()
    .from(itineraries)
    .where(eq(itineraries.userId, actor.userId))
    .orderBy(desc(itineraries.startsAt))
    .limit(20);
  const tripPlans = journeys.filter((trip) => trip.kind === 'TRIP' || trip.kind === 'JOURNEY');

  const now = new Date();
  const attention = bookings.filter(
    (booking) =>
      booking.state === 'BOOKING_FAILED' ||
      booking.state === 'PRICE_CHANGED' ||
      booking.state === 'PAYMENT_FAILED' ||
      booking.state === 'REVALIDATION_FAILED',
  );
  const attentionRefs = new Set(attention.map((booking) => booking.ref));
  const upcoming = bookings
    .filter(
      (booking) =>
        !attentionRefs.has(booking.ref) &&
        booking.departAt >= now &&
        booking.state !== 'CANCELLED' &&
        booking.state !== 'REFUNDED',
    )
    .sort((a, b) => a.departAt.getTime() - b.departAt.getTime());
  const upcomingRefs = new Set(upcoming.map((booking) => booking.ref));
  const past = bookings
    .filter((booking) => !upcomingRefs.has(booking.ref) && !attentionRefs.has(booking.ref))
    .sort((a, b) => b.departAt.getTime() - a.departAt.getTime());

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow={<Link href="/travel">Travel</Link>}
        title="Your trips"
        lede="Flights you have booked, and the trips the planner has put together for you."
        actions={
          sources.state === 'NONE' ? undefined : (
            <ButtonLink href="/travel/flights" variant="primary">
              Book a flight
            </ButtonLink>
          )
        }
      />

      {done ? <Notice tone="info">{done}</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}

      {attention.length > 0 ? (
        <section aria-labelledby="attention-heading" className="stack stack-4">
          <div className="section-head">
            <h2 id="attention-heading">Needs you</h2>
          </div>
          <ul className="stack stack-3">
            {attention.map((booking) => (
              <li key={booking.ref}>
                <Link href={`/travel/trips/${booking.ref}`} className="op-trip op-trip-bad">
                  <span>
                    <span className="op-trip-route">
                      {booking.originCode} → {booking.destinationCode}
                    </span>
                    <span className="small muted" style={{ display: 'block' }}>
                      {booking.state === 'BOOKING_FAILED'
                        ? `You were charged ${booking.chargedTotalMinor ? '' : ''}and no seat was confirmed. A refund is owed.`
                        : (booking.failureDetail ?? STATE_LABEL[booking.state])}
                    </span>
                  </span>
                  <Badge tone={STATE_TONE[booking.state] ?? 'neutral'}>{STATE_LABEL[booking.state]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="upcoming-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="upcoming-heading">Coming up</h2>
          {upcoming.length > 0 ? (
            <span className="small muted">{formatRelative(upcoming[0]!.departAt)}</span>
          ) : null}
        </div>

        {upcoming.length === 0 ? (
          <Card>
            <Empty
              title="Nothing booked yet"
              body={
                sources.state === 'NONE'
                  ? 'Flights you book would appear here as boarding passes. No flight source is connected to this deployment, so there is nothing to book.'
                  : 'Flights you book appear here as boarding passes, with the airline’s reference and your ticket numbers as soon as they exist.'
              }
              action={
                sources.state === 'NONE' ? undefined : (
                  <ButtonLink href="/travel/flights">Search flights</ButtonLink>
                )
              }
            />
          </Card>
        ) : (
          <ul className="shelf shelf-wide stagger">
            {upcoming.map((booking) => (
              <li key={booking.ref}>
                <BoardingPass
                  booking={booking}
                  airline={airlines.get(booking.marketingCarrier)}
                  originCity={places.get(booking.originCode)?.city}
                  destinationCity={places.get(booking.destinationCode)?.city}
                  href={`/travel/trips/${booking.ref}`}
                  transitionName={`flight-${booking.ref}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {tripPlans.length > 0 ? (
        <section aria-labelledby="plans-heading" className="stack stack-4">
          <div className="section-head">
            <h2 id="plans-heading">Planned trips</h2>
            <Link className="small" href="/travel/stay">
              Plan another
            </Link>
          </div>
          <Card>
            <ul className="ledger">
              {tripPlans.map((trip) => (
                <li key={trip.id}>
                  <span className="ledger-main">
                    <span className="ledger-title">{trip.title}</span>
                    <span className="ledger-meta">
                      {trip.startsAt ? formatDate(trip.startsAt) : 'No dates'} ·{' '}
                      <Money minor={trip.plannedSpendMinor} /> planned
                      {trip.plannedSavingMinor > 0 ? (
                        <>
                          {' '}
                          · <Money minor={trip.plannedSavingMinor} /> saved
                        </>
                      ) : null}
                    </span>
                  </span>
                  <Badge tone={trip.state === 'COMPLETED' ? 'ok' : 'neutral'}>
                    {trip.state.toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="past-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="past-heading">Past and cancelled</h2>
        </div>
        {past.length === 0 ? (
          <Card>
            <Empty
              title="No history yet"
              body="A flight that has departed, been cancelled or been refunded moves here and stays as a record."
            />
          </Card>
        ) : (
          <Card>
            <ul className="ledger">
              {past.map((booking) => (
                <li key={booking.ref}>
                  <span className="ledger-main">
                    <Link className="ledger-title" href={`/travel/trips/${booking.ref}`}>
                      {places.get(booking.originCode)?.city ?? booking.originCode} →{' '}
                      {places.get(booking.destinationCode)?.city ?? booking.destinationCode}
                    </Link>
                    <span className="ledger-meta">
                      {dayLabel(booking.departAt)}
                      {booking.chargedTotalMinor ? (
                        <>
                          {' · '}
                          <Money minor={booking.chargedTotalMinor} /> charged
                        </>
                      ) : null}
                      {booking.pnr ? ` · ${booking.pnr}` : ''}
                    </span>
                  </span>
                  <Badge tone={STATE_TONE[booking.state] ?? 'neutral'}>{STATE_LABEL[booking.state]}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <p className="tiny muted">
        Bookings are shown for the account you are signed in to. A reference belonging to somebody else is
        not found rather than refused — a refusal would confirm it exists.
      </p>
    </div>
  );
}
