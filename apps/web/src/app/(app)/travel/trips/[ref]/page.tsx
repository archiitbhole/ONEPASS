/**
 * One booking, in whatever state it is actually in.
 *
 * The page is built around the state machine rather than around the happy path.
 * Fourteen states, each with its own correct thing to say and its own correct
 * thing to offer — and the ones that matter most are the ones nobody wants:
 *
 *  · **BOOKING_FAILED** says outright that money was taken and there is no seat,
 *    names the amount, and says a refund is being arranged. It does not offer a
 *    retry, because retrying is how a customer ends up with two bookings.
 *  · **PRICE_CHANGED** sends them back to the booking screen, where both figures
 *    are shown, rather than deciding on their behalf.
 *  · **PAYMENT_AUTHORIZED** and **BOOKING_PENDING** say the money moved and the
 *    airline has not answered yet — which is true, and better than a spinner.
 *
 * Ticket numbers and the record locator are shown as soon as they exist, because
 * they are what a person needs at an airport and they should not have to open an
 * email to find them.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { flightBookings, flightPassengers, flightSegments } from '@/db/schema';
import {
  Badge,
  Button,
  Card,
  CardHead,
  DefinitionList,
  Notice,
  PageHead,
  Stack,
  Steps,
  formatDateTime,
  formatMoney,
} from '@/components/ui';
import {
  STATE_LABEL,
  cabinLabel,
  clock,
  dayLabel,
  duration,
  stopsLabel,
} from '@/components/travel/format';
import { BoardingPass } from '@/components/travel/boarding-pass';
import { bookingSteps } from '@/components/travel/booking-progress';
import { RouteArc } from '@/components/travel/route-arc';
import { HOLDING_STATES, PAID_STATES, nextStep, type BookingState } from '@/lib/travel/booking-state';
import { cashbackFor } from '@/lib/travel/cashback';
import { currentActor } from '../../../_queries';
import { airlineNames, airportsByCode } from '../../_queries';
import { cancelBookingAction } from '../../actions';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Trip',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { ref } = await params;
  const { done, error } = await searchParams;
  const actor = await currentActor();

  const booking = await db.query.flightBookings.findFirst({
    where: and(eq(flightBookings.publicRef, ref), eq(flightBookings.userId, actor.userId)),
    with: {
      passengers: { orderBy: [flightPassengers.position] },
      tickets: true,
    },
  });
  if (!booking) notFound();

  const segments = booking.offerId
    ? await db.query.flightSegments.findMany({
        where: eq(flightSegments.offerId, booking.offerId),
        orderBy: [flightSegments.sliceIndex, flightSegments.position],
      })
    : [];

  const [airlines, places, cashback] = await Promise.all([
    airlineNames(),
    airportsByCode([booking.originCode, booking.destinationCode]),
    cashbackFor(actor.userId, 50),
  ]);

  const bookingCashback = cashback.filter((row) => row.bookingRef === booking.publicRef);
  const state = booking.state as BookingState;
  const originPlace = places.get(booking.originCode);
  const destinationPlace = places.get(booking.destinationCode);
  // Null for a booking that stopped — see `bookingSteps`.
  const steps = bookingSteps(
    state,
    { revalidatedAt: booking.revalidatedAt, confirmedAt: booking.confirmedAt, ticketedAt: booking.ticketedAt },
    (at) => formatDateTime(at),
  );
  const paid = PAID_STATES.includes(state);
  const holding = HOLDING_STATES.includes(state);
  const step = nextStep(state);
  const ticketsByPassenger = new Map(
    booking.tickets.map((ticket) => [ticket.passengerId, ticket.ticketNumber]),
  );

  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap stack stack-5">
      <PageHead
        eyebrow={
          <>
            <Link href="/travel/trips">Trips</Link> · <span className="mono">{booking.publicRef}</span>
          </>
        }
        title={`${places.get(booking.originCode)?.city ?? booking.originCode} to ${
          places.get(booking.destinationCode)?.city ?? booking.destinationCode
        }`}
        lede={`${dayLabel(booking.departAt)} · ${
          airlines.get(booking.marketingCarrier) ?? booking.marketingCarrier
        } · ${cabinLabel(booking.cabin)} · ${booking.passengerCount} passenger${
          booking.passengerCount === 1 ? '' : 's'
        }`}
      />

      {done ? <Notice tone="info">{done}</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}

      {/*
        The booking as the thing a person carries, beside where it has got to.

        The stamp on the stub is the booking's own state — only CONFIRMED and
        TICKETED are drawn as valid, and a sample booking is stamped SAMPLE
        whatever else is true of it, because no airline is holding it. The
        stations beside it come from the same state machine the service
        enforces, so PAYMENT_FAILED (no money, no seat) and BOOKING_FAILED
        (money taken, no seat) land on different stations and always will.
      */}
      <div className="object-detail">
        <div className="stack stack-4">
          <BoardingPass
            booking={{
              ref: booking.publicRef,
              state: booking.state,
              source: booking.source,
              pnr: booking.pnr,
              originCode: booking.originCode,
              destinationCode: booking.destinationCode,
              departAt: booking.departAt,
              returnAt: booking.returnAt,
              cabin: booking.cabin,
              marketingCarrier: booking.marketingCarrier,
              passengerCount: booking.passengerCount,
            }}
            airline={airlines.get(booking.marketingCarrier)}
            ticketNumber={booking.tickets[0]?.ticketNumber ?? null}
            originCity={places.get(booking.originCode)?.city}
            destinationCity={places.get(booking.destinationCode)?.city}
            transitionName={`trip-${booking.publicRef}`}
          />

          {originPlace && destinationPlace ? (
            <Card>
              <RouteArc from={originPlace} to={destinationPlace} />
            </Card>
          ) : null}
        </div>

        <aside className="object-detail-aside">
          {steps ? (
            <Card className="stack stack-3">
              <h2 className="h3">Where this has got to</h2>
              <Steps label={`Progress of booking ${booking.publicRef}`} steps={steps} />
            </Card>
          ) : (
            <Card className="stack stack-2">
              <h2 className="h3">{STATE_LABEL[state]}</h2>
              <p className="small muted">
                This booking stopped rather than progressed, so there is no line to draw across. What happened is
                below.
              </p>
            </Card>
          )}

          {booking.pnr ? (
            <Card className="stack stack-2">
              <p className="eyebrow">Airline reference</p>
              <p className="op-pnr">{booking.pnr}</p>
              <p className="small muted">
                Quote this at the airline’s own check-in and to its customer service. It is the airline’s record,
                not {BRAND.name}’s — ours is <span className="mono">{booking.publicRef}</span>.
              </p>
            </Card>
          ) : null}
        </aside>
      </div>

      {/* The state that owes somebody money gets the loudest treatment. */}
      {state === 'BOOKING_FAILED' ? (
        <Notice tone="bad">
          <strong>You were charged {formatMoney(booking.chargedTotalMinor ?? 0)} and the airline did not confirm a seat.</strong>{' '}
          {booking.failureDetail ?? 'A refund is being arranged.'} This is not something to retry — a
          second attempt would risk a second booking. If you have not heard within two working days,{' '}
          <Link href="/help">open a support request</Link> quoting {booking.publicRef}.
        </Notice>
      ) : null}

      {state === 'PRICE_CHANGED' ? (
        <Notice tone="warn">
          The airline changed this fare before it was paid for. Nothing has been charged.{' '}
          <Link href={`/travel/book/${booking.publicRef}`}>See both prices and decide</Link>.
        </Notice>
      ) : null}

      {state !== 'BOOKING_FAILED' && state !== 'PRICE_CHANGED' && step ? (
        <Notice tone={state === 'CONFIRMED' || state === 'TICKETED' ? 'ok' : 'info'}>{step}</Notice>
      ) : null}

      {segments.length > 0 ? (
        <Card>
          <Stack gap={3}>
            <CardHead title="Your journey" />
            <div>
              {segments.map((leg) => (
                <div key={leg.id} className="op-leg-row">
                  <div className="small muted" style={{ minWidth: 54 }}>
                    {leg.marketingCarrier} {leg.flightNumber}
                  </div>
                  <div>
                    <p>
                      <span className="op-leg-clock">{clock(leg.departAt)}</span> {leg.originCode}
                      {leg.originTerminal ? ` (T${leg.originTerminal})` : ''} →{' '}
                      <span className="op-leg-clock">{clock(leg.arriveAt)}</span> {leg.destinationCode}
                      {leg.destinationTerminal ? ` (T${leg.destinationTerminal})` : ''}
                    </p>
                    <p className="small muted">
                      {dayLabel(leg.departAt)} · {duration(leg.durationMinutes)} · {cabinLabel(leg.cabin)}
                      {leg.aircraft ? ` · ${leg.aircraft}` : ''}
                      {leg.operatingCarrier && leg.operatingCarrier !== leg.marketingCarrier
                        ? ` · operated by ${airlines.get(leg.operatingCarrier) ?? leg.operatingCarrier}`
                        : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="tiny muted">
              {stopsLabel(Math.max(0, segments.filter((leg) => leg.sliceIndex === 0).length - 1))} outbound
              {booking.returnAt ? ` · returning ${dayLabel(booking.returnAt)}` : ''}
            </p>
          </Stack>
        </Card>
      ) : null}

      <Card>
        <Stack gap={3}>
          <CardHead title="Passengers" />
          {booking.passengers.length === 0 ? (
            <p className="small muted">No passengers have been added yet.</p>
          ) : (
            <ul className="stack stack-2">
              {booking.passengers.map((passenger) => (
                <li key={passenger.id} className="row-between" style={{ gap: 12, alignItems: 'flex-start' }}>
                  <span>
                    <strong>
                      {passenger.title ? `${passenger.title} ` : ''}
                      {passenger.givenName} {passenger.familyName}
                    </strong>
                    <span className="small muted" style={{ display: 'block' }}>
                      {passenger.kind === 'ADULT' ? 'Adult' : passenger.kind === 'CHILD' ? 'Child' : 'Infant'}
                      {/* The document is shown by its last two characters and no
                          more. The number itself is encrypted and is never
                          returned by any API. */}
                      {passenger.documentLast2 ? ` · document •••• ${passenger.documentLast2}` : ''}
                      {passenger.seatNumber ? ` · seat ${passenger.seatNumber}` : ''}
                    </span>
                  </span>
                  {ticketsByPassenger.has(passenger.id) ? (
                    <span className="mono tiny">{ticketsByPassenger.get(passenger.id)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </Card>

      {paid ? (
        <Card>
          <Stack gap={3}>
            <CardHead title="What you paid" />
            <div>
              <div className="op-price-row">
                <span>Fare, taxes and fees</span>
                <span className="num">
                  {formatMoney(booking.confirmedTotalMinor ?? booking.selectedTotalMinor)}
                </span>
              </div>
              {booking.bankDiscountMinor > 0 ? (
                <div className="op-price-row">
                  <span>Bank offer</span>
                  <span className="num">−{formatMoney(booking.bankDiscountMinor)}</span>
                </div>
              ) : null}
              {booking.pointsDiscountMinor > 0 ? (
                <div className="op-price-row">
                  <span>{booking.pointsSpent.toLocaleString('en-IN')} {BRAND.name} points</span>
                  <span className="num">−{formatMoney(booking.pointsDiscountMinor)}</span>
                </div>
              ) : null}
              <div className="op-price-row">
                <span style={{ fontWeight: 700 }}>Charged</span>
                <span className="num" style={{ fontWeight: 700 }}>
                  {formatMoney(booking.chargedTotalMinor ?? 0)}
                </span>
              </div>
            </div>
          </Stack>
        </Card>
      ) : null}

      {bookingCashback.length > 0 ? (
        <Card>
          <Stack gap={3}>
            <CardHead title="Cashback" />
            {bookingCashback.map((row) => (
              <div key={row.ref}>
                <p>
                  <strong>{formatMoney(row.amountMinor)}</strong>{' '}
                  <Badge
                    tone={
                      row.state === 'CREDITED'
                        ? 'ok'
                        : row.state === 'REVERSED' || row.state === 'EXPIRED'
                          ? 'neutral'
                          : 'warn'
                    }
                  >
                    {row.state.toLowerCase()}
                  </Badge>
                </p>
                <p className="small muted">
                  {row.method}.{' '}
                  {row.state === 'CREDITED'
                    ? `Credited as points on ${row.creditedAt ? formatDateTime(row.creditedAt) : 'a recent date'}.`
                    : row.state === 'REVERSED'
                      ? (row.reversedReason ?? 'Reversed.')
                      : row.state === 'EXPIRED'
                        ? 'This cashback expired before it was credited.'
                        : `Credited as ${BRAND.name} points after ${dayLabel(row.approveAfter)}, once the airline’s cancellation window has passed.`}
                </p>
              </div>
            ))}
          </Stack>
        </Card>
      ) : null}

      <Card>
        <Stack gap={3}>
          <CardHead title="Details" />
          <DefinitionList
            items={[
              [`${BRAND.name} reference`, <span key="ref" className="mono">{booking.publicRef}</span>],
              ['Airline reference', booking.pnr ? <span key="pnr" className="mono">{booking.pnr}</span> : 'Not issued'],
              ['Booked', formatDateTime(booking.createdAt)],
              ['Source', booking.source === 'SAMPLE' ? 'Development sample source' : booking.source],
              ['State', STATE_LABEL[state] ?? state],
              ...(booking.confirmedAt ? ([['Confirmed with the airline', formatDateTime(booking.confirmedAt)]] as [string, string][]) : []),
              ...(booking.ticketedAt ? ([['Ticketed', formatDateTime(booking.ticketedAt)]] as [string, string][]) : []),
              ...(booking.cancelledAt ? ([['Cancelled', formatDateTime(booking.cancelledAt)]] as [string, string][]) : []),
            ]}
          />
        </Stack>
      </Card>

      {holding ? (
        <Card>
          <Stack gap={3}>
            <CardHead title="Cancel this booking" />
            <p className="small">
              Cancelling asks the airline to cancel it. What you get back depends on the fare’s own
              conditions, and the airline decides it — {BRAND.name} shows you the figure the airline quotes
              rather than promising one.
            </p>
            <form action={cancelBookingAction}>
              <input type="hidden" name="ref" value={booking.publicRef} />
              <Button type="submit" variant="danger">
                Cancel this booking
              </Button>
            </form>
          </Stack>
        </Card>
      ) : null}
    </div>
  );
}
