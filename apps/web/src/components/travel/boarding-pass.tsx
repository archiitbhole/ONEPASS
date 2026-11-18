/**
 * A flight booking, drawn as the thing it is.
 *
 * Everything else a person holds in this product — a cinema ticket, a warranty,
 * a receipt — is rendered as printed stock. A flight was the one that came out
 * as a link in a list, which made the single most anticipated row in the
 * account look less like something you carry than a cinema seat.
 *
 * So: `<Ticket kind="boarding">`, with the route across the face at the size an
 * airport needs it, the times and the reference in the fields, and the state
 * stamped on the stub in a word rather than only a colour.
 *
 * **The stamp is the booking's own state, never a guess.** A booking that is
 * paid but unconfirmed is stamped as unconfirmed; only `CONFIRMED` and
 * `TICKETED` are drawn as valid. A sample booking is stamped `SAMPLE` whatever
 * else is true of it, because no airline is holding it.
 */
import type { TicketState } from '@/components/objects';
import { Ticket } from '@/components/objects';
import { formatDateTime } from '@/components/ui';
import { STATE_LABEL, cabinLabel, clock, dayLabel } from './format';
import type { BookingState } from '@/lib/travel/booking-state';
import type { Cabin } from '@/lib/travel/providers/types';

export interface BoardingBooking {
  ref: string;
  state: string;
  source: string;
  pnr: string | null;
  originCode: string;
  destinationCode: string;
  departAt: Date;
  returnAt?: Date | null;
  cabin: Cabin;
  marketingCarrier: string;
  passengerCount: number;
}

/** How the printed object draws a booking state. */
export function boardingStateOf(state: string): TicketState {
  switch (state) {
    case 'CONFIRMED':
    case 'TICKETED':
      return 'valid';
    case 'CANCELLED':
    case 'REFUNDED':
      return 'void';
    case 'REVALIDATION_FAILED':
      return 'expired';
    default:
      // Everything in between — selected, re-checked, paid, awaiting the
      // airline — is pending. None of it is a seat yet.
      return 'pending';
  }
}

/** The one word stamped on the stub, and its tone. */
export function boardingStamp(state: string, source: string): { word: string; tone: 'ok' | 'bad' | 'neutral' | 'info' } {
  if (source === 'SAMPLE') return { word: 'Sample', tone: 'neutral' };
  switch (state) {
    case 'TICKETED':
      return { word: 'Ticketed', tone: 'ok' };
    case 'CONFIRMED':
      return { word: 'Confirmed', tone: 'ok' };
    case 'BOOKING_FAILED':
      return { word: 'Not flown', tone: 'bad' };
    case 'PAYMENT_FAILED':
      return { word: 'Unpaid', tone: 'bad' };
    case 'CANCELLED':
      return { word: 'Cancelled', tone: 'neutral' };
    case 'REFUNDED':
      return { word: 'Refunded', tone: 'neutral' };
    case 'PRICE_CHANGED':
      return { word: 'Re-quoted', tone: 'info' };
    case 'PAYMENT_AUTHORIZED':
    case 'BOOKING_PENDING':
      return { word: 'Paid', tone: 'info' };
    default:
      return { word: STATE_LABEL[state] ?? 'Pending', tone: 'info' };
  }
}

export function BoardingPass({
  booking,
  airline,
  originCity,
  destinationCity,
  href,
  transitionName,
  ticketNumber,
}: {
  booking: BoardingBooking;
  /** The airline's own ticket number, once one exists. Read by the page. */
  ticketNumber?: string | null;
  /** The carrier's name, resolved by the page. The object never queries. */
  airline?: string | null;
  originCity?: string | null;
  destinationCity?: string | null;
  href?: string;
  transitionName?: string;
}) {
  const stamp = boardingStamp(booking.state, booking.source);
  const carrier = airline ?? booking.marketingCarrier;

  return (
    <Ticket
      kind="boarding"
      state={boardingStateOf(booking.state)}
      href={href}
      transitionName={transitionName}
      label={`${carrier}, ${booking.originCode} to ${booking.destinationCode} on ${dayLabel(booking.departAt)} — ${
        STATE_LABEL[booking.state] ?? booking.state
      }`}
    >
      <Ticket.Main>
        <Ticket.Band label="Boarding pass" right={carrier} />
        <Ticket.Route
          from={booking.originCode}
          to={booking.destinationCode}
          fromCity={originCity ?? undefined}
          toCity={destinationCity ?? undefined}
        />
        <Ticket.Fields
          items={[
            { label: 'Departs', value: `${dayLabel(booking.departAt)} · ${clock(booking.departAt)}` },
            { label: 'Cabin', value: cabinLabel(booking.cabin) },
            {
              label: 'Travellers',
              value: `${booking.passengerCount} passenger${booking.passengerCount === 1 ? '' : 's'}`,
            },
            booking.pnr
              ? { label: 'Airline ref', value: booking.pnr, mono: true }
              : { label: 'Airline ref', value: 'Not issued yet' },
          ]}
        />
      </Ticket.Main>
      <Ticket.Stub>
        <Ticket.Stamp tone={stamp.tone}>{stamp.word}</Ticket.Stamp>
        {/*
          The stub carries what an airport asks for, in the order it is asked
          for. No QR: nothing issues a scannable boarding code here, and a
          drawn square that scans to nothing on a phone at a gate is worse than
          an empty stub. A ticket number appears only once an airline has issued
          one — `ticketNumber` is a column, not a formatting of the reference.
        */}
        {ticketNumber ? (
          <span className="ticket-field">
            <span className="ticket-label">Ticket</span>
            <span className="ticket-ref">{ticketNumber}</span>
          </span>
        ) : null}
        <span className="ticket-field">
          <span className="ticket-label">Our reference</span>
          <span className="ticket-ref">{booking.ref}</span>
        </span>
      </Ticket.Stub>
    </Ticket>
  );
}

/** The one-line version for a row in a list: state, in words, with the date. */
export function boardingLine(booking: BoardingBooking): string {
  return `${STATE_LABEL[booking.state as BookingState] ?? booking.state} · ${formatDateTime(booking.departAt)}`;
}
