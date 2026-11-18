/**
 * The ticket wallet.
 *
 * Two lists from two calls, because "upcoming" is the service's definition
 * rather than this page's: `listTickets({ upcoming: true })` means still ISSUED
 * and still inside its validity window, ordered soonest-first. Everything else
 * — admitted, void, expired, transferred — is history, and history reads
 * newest-first.
 *
 * Upcoming tickets are drawn as the objects they are: a shelf of things you
 * are holding, each one openable into the code at the door. History is a
 * ledger instead — a used ticket is a record, and a record does not need to be
 * the size of a boarding pass.
 *
 * The past list is the full list minus the upcoming ids, so a ticket can never
 * appear in both. Nothing here re-decides a ticket's state; the stamp is the
 * state machine's own word, the same one the door console shows.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, Card, Empty, PageHead, formatDateTime, formatRelative } from '@/components/ui';
import { Ticket } from '@/components/objects';
import { TransitionLink } from '@/components/system/view-transitions';
import {
  ticketBandLabel,
  ticketKindFor,
  ticketStampWord,
  ticketStateOf,
  ticketWhere,
} from '@/components/consumer/ticket-shape';
import { listTickets } from '@/lib/commerce/tickets';
import { ClaimTicket } from '@/components/consumer/ticket-actions';
import { currentActor } from '../_queries';
import { LiveRefresh } from '@/components/realtime/live-refresh';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Tickets',
  description: `Every ticket on your ${BRAND.name}, upcoming first.`,
};

export const dynamic = 'force-dynamic';

type Row = Awaited<ReturnType<typeof listTickets>>[number];

function UpcomingTicket({ row }: { row: Row }) {
  const { ticket, venue } = row;
  const stamp = ticketStampWord(ticket.state);
  const where = ticketWhere(ticket.title, venue);

  return (
    <li>
      <Ticket
        kind={ticketKindFor(venue?.kind)}
        state={ticketStateOf(ticket.state)}
        href={`/tickets/${ticket.publicRef}`}
        transitionName={`ticket-${ticket.publicRef}`}
        label={`${ticket.title} — open ticket`}
      >
        <Ticket.Main>
          <Ticket.Band label={ticketBandLabel(venue?.kind)} right={ticket.seatLabel || undefined} />
          <Ticket.Title>{ticket.title}</Ticket.Title>
          <Ticket.Fields
            items={[
              { label: 'Doors', value: formatDateTime(ticket.validFrom) },
              { label: 'Starts', value: formatRelative(ticket.validFrom) },
              ...(where ? [{ label: 'Where', value: where }] : []),
              { label: 'Admits', value: String(ticket.admitCount) },
            ]}
          />
        </Ticket.Main>
        <Ticket.Stub>
          <Ticket.Stamp tone={stamp.tone}>{stamp.word}</Ticket.Stamp>
          {/* The reference, printed. It is what a person reads out when a
              scanner will not read the code, so it belongs on the stub rather
              than only on the screen behind it. */}
          <span className="ticket-field">
            <span className="ticket-label">Reference</span>
            <span className="ticket-ref">{ticket.publicRef}</span>
          </span>
          <span className="ticket-label">Open to show</span>
        </Ticket.Stub>
      </Ticket>
    </li>
  );
}

function PastTicket({ row }: { row: Row }) {
  const { ticket, venue } = row;
  const stamp = ticketStampWord(ticket.state);

  return (
    <li>
      <span className="ledger-main">
        <TransitionLink className="ledger-title" href={`/tickets/${ticket.publicRef}`}>
          {ticket.title}
        </TransitionLink>
        <span className="ledger-meta">
          {venue ? `${venue.name} · ` : ''}
          {formatDateTime(ticket.validFrom)}
          {ticket.admittedAt ? ` · admitted ${formatRelative(ticket.admittedAt)}` : ''}
        </span>
      </span>
      <span className={`badge badge-${stamp.tone === 'ok' ? 'ok' : stamp.tone === 'bad' ? 'bad' : 'neutral'}`}>
        {stamp.word}
      </span>
    </li>
  );
}

export default async function TicketsPage() {
  const actor = await currentActor();

  const [upcoming, everything] = await Promise.all([
    listTickets({ userId: actor.userId, upcoming: true, limit: 100 }),
    listTickets({ userId: actor.userId, limit: 200 }),
  ]);

  const upcomingIds = new Set(upcoming.map((r) => r.ticket.id));
  const past = everything.filter((r) => !upcomingIds.has(r.ticket.id));

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Show at the door"
        title="Tickets"
        lede={
          upcoming.length > 0
            ? `${upcoming.length} ticket${upcoming.length === 1 ? '' : 's'} still to use.`
            : 'Tickets issued against a confirmed booking appear here.'
        }
        actions={
          /*
            No TICKET_ISSUED here, deliberately. A ticket is only ever created by
            confirmBooking, which already emits BOOKING_CONFIRMED on this
            person's own channel carrying the new ticket's reference — so a
            TICKET_ISSUED alongside it would be a second event for the same
            instant and a second name for the same fact.
          */
          <LiveRefresh types={['TICKET_ADMITTED', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED']} noun="update" />
        }
      />

      <section aria-labelledby="upcoming-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="upcoming-heading">Upcoming</h2>
        </div>
        {upcoming.length > 0 ? (
          <ul className="shelf shelf-wide stagger">
            {upcoming.map((row) => (
              <UpcomingTicket key={row.ticket.id} row={row} />
            ))}
          </ul>
        ) : (
          <Card>
            <Empty
              title="Nothing to use yet"
              body="A ticket is issued the moment a booking is confirmed, and carries the code the door scans."
              action={
                <ButtonLink href="/deals" variant="primary">
                  See live deals
                </ButtonLink>
              }
            />
          </Card>
        )}
      </section>

      <section aria-labelledby="claim-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="claim-heading">Been given a ticket?</h2>
        </div>
        <Card>
          <div className="stack stack-3">
            <p className="small muted measure">
              Enter the code the other person sent you. The seat becomes yours with a reference of its
              own, and theirs stops working at the door — so only one of you can be admitted, which is
              the point.
            </p>
            <ClaimTicket />
          </div>
        </Card>
      </section>

      <section aria-labelledby="past-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="past-heading">Past</h2>
          <Link className="small" href="/bookings">
            Bookings behind them
          </Link>
        </div>
        {past.length > 0 ? (
          <Card>
            <ul className="ledger">
              {past.map((row) => (
                <PastTicket key={row.ticket.id} row={row} />
              ))}
            </ul>
          </Card>
        ) : (
          <Card>
            <Empty
              title="No past tickets"
              body="Once a ticket has been admitted, expired or cancelled it moves here and stays as a record."
            />
          </Card>
        )}
      </section>
    </div>
  );
}
