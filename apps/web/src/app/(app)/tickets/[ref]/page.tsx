/**
 * One ticket, at door-facing size.
 *
 * The code is drawn by `QrSvg` in pure black on pure white — never a theme colour,
 * because a scanner reads luminance and a code drawn in the palette's ink fails on
 * a dark screen at a cinema entrance. It encodes the ticket's public reference,
 * which is exactly what the door console accepts, and the reference is printed
 * underneath it for the evening the lens is dirty.
 *
 * A ticket that will not be admitted does not get a code. Showing a scannable
 * square for an already-admitted or expired ticket is a promise the door will
 * break in front of the person holding the phone, so the state is stated instead.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ButtonLink,
  Card,
  DefinitionList,
  Notice,
  Stack,
  StatusBadge,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { venueLine } from '@/components/consumer/format';
import { QrSvg } from '@/components/consumer/qr';
import { TicketStub } from '@/components/consumer/ticket-stub';
import { ticketWhere } from '@/components/consumer/ticket-shape';
import { KeepTicketOffline } from '@/components/consumer/keep-offline';
import { TransferTicket } from '@/components/consumer/ticket-actions';
import { getTicket } from '@/lib/commerce/tickets';
import { listPendingTicketOffers } from '@/lib/commerce/ticket-transfer';
import { currentActor } from '../../_queries';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { ref } = await params;
  return { title: `Ticket ${ref}` };
}


export default async function TicketPage({ params }: { params: Promise<{ ref: string }> }) {
  const actor = await currentActor();
  const { ref } = await params;

  const found = await getTicket({ publicRef: ref, userId: actor.userId });
  if (!found) notFound();

  const { ticket, venue, booking } = found;
  const now = new Date();

  // Only this ticket's outstanding offer, if there is one: the screen needs to
  // show "cancel" instead of "pass on", and say when the code lapses.
  const pendingOffer = (await listPendingTicketOffers(actor.userId)).find(
    (offer) => offer.ticketRef === ticket.publicRef,
  );

  const notYet = ticket.validFrom.getTime() > now.getTime();
  const lapsed = ticket.validUntil !== null && ticket.validUntil.getTime() < now.getTime();
  const scannable = ticket.state === 'ISSUED' && !lapsed;

  // The door's own order of refusal, said in the words the door would use.
  const refusal =
    ticket.state === 'ADMITTED'
      ? 'This ticket has already been used. A door will refuse it a second time.'
      : ticket.state === 'VOID'
        ? 'This ticket was cancelled and will not be admitted.'
        : ticket.state === 'TRANSFERRED'
          ? 'This ticket was transferred to someone else — their copy is the one that scans.'
          : ticket.state === 'EXPIRED' || lapsed
            ? 'This ticket is past its validity window and will not be admitted.'
            : null;

  return (
    <div className="wrap-narrow">
      <Stack gap={5}>
        <p className="small">
          <Link href="/tickets">← All tickets</Link>
        </p>

        {/* Copied to the device as it is opened, so it still works in a
            basement. Renders nothing. See lib/offline/tickets.ts for what is
            stored and why it is tickets and never the pass. */}
        <KeepTicketOffline
          reference={ticket.publicRef}
          title={ticket.title}
          place={venue?.name ?? null}
          seatLabel={ticket.seatLabel}
          admitCount={ticket.admitCount}
          validFrom={ticket.validFrom.toISOString()}
          validUntil={ticket.validUntil?.toISOString() ?? null}
          state={ticket.state}
        />

        {/* The ticket itself. The heading is on the object — a page title
            repeating it above put the film's name on screen twice before the
            code, which is the one thing the screen exists to show. */}
        <TicketStub
          title={ticket.title}
          subtitle={ticket.subtitle}
          place={ticketWhere(ticket.title, venue)}
          venueKind={venue?.kind ?? null}
          transitionName={`ticket-${ticket.publicRef}`}
          seatLabel={ticket.seatLabel}
          admitCount={ticket.admitCount}
          doorsAt={formatDateTime(ticket.validFrom)}
          state={ticket.state}
          scannable={scannable}
          reference={ticket.publicRef}
          code={
            <QrSvg
              text={ticket.publicRef}
              level="M"
              size={260}
              title={`Ticket ${ticket.publicRef} — show this at the door`}
            />
          }
        />

        <Card>
          <Stack gap={5}>
            {!scannable ? (
              <Notice tone={ticket.state === 'ADMITTED' ? 'info' : 'bad'}>
                <Glyph name="alert" size={18} />
                <span>{refusal ?? `This ticket is ${ticket.state.toLowerCase()} and has no scannable code.`}</span>
              </Notice>
            ) : null}

            {scannable && notYet ? (
              <Notice tone="warn">
                <Glyph name="clock" size={18} />
                <span>
                  This ticket is not valid yet — it opens at {formatDateTime(ticket.validFrom)}, {formatRelative(ticket.validFrom)}. A
                  door scanning it before then will turn it away.
                </span>
              </Notice>
            ) : null}

            <DefinitionList
              items={[
                ['Reference', <span key="r" className="mono">{ticket.publicRef}</span>],
                // `||`, not `??`: a merchant that sends an empty seat label means
                // "no seat", and `??` would print a blank row.
                ['Seat', ticket.seatLabel || 'Unreserved'],
                ['Admits', `${ticket.admitCount} ${ticket.admitCount === 1 ? 'person' : 'people'}`],
                ['Valid from', `${formatDateTime(ticket.validFrom)} · ${formatRelative(ticket.validFrom)}`],
                ['Valid until', ticket.validUntil ? formatDateTime(ticket.validUntil) : 'No end recorded'],
                [
                  'Venue',
                  venue ? <span key="v">{venueLine(venue)}</span> : 'No venue recorded',
                ],
                ...(ticket.admittedAt
                  ? ([['Admitted', formatDateTime(ticket.admittedAt)]] as [React.ReactNode, React.ReactNode][])
                  : []),
              ]}
            />
          </Stack>
        </Card>

        <Notice tone="info">
          <Glyph name="shield" size={18} />
          <span>
            The code carries this ticket&apos;s reference and nothing else — not your name, your number or what else
            you have booked. It can be admitted once; a second scan is refused at the door rather than quietly
            accepted.
          </span>
        </Notice>

        {ticket.state === 'ISSUED' ? (
          <Card>
            <Stack gap={3}>
              <h2 className="h3">Someone else going?</h2>
              <p className="small muted">
                Pass the seat on with a one-time code. They get their own reference and this one stops
                working at the door — so nobody turns up to find the seat already taken. Your booking and
                your payment stay with you.
              </p>
              <TransferTicket
                ticketRef={ticket.publicRef}
                title={ticket.title}
                seatLabel={ticket.seatLabel}
                pendingRef={pendingOffer?.reference ?? null}
              />
              {pendingOffer ? (
                <p className="tiny muted">
                  A code for this ticket is waiting to be claimed, and lapses{' '}
                  {formatRelative(pendingOffer.expiresAt)}. Cancelling it stops that code working.
                </p>
              ) : null}
            </Stack>
          </Card>
        ) : null}

        {booking ? (
          <Card>
            <Stack gap={3}>
              <h2 className="h3">The booking behind it</h2>
              <p className="small muted">
                Issued against <span className="mono">{booking.publicRef}</span>, which holds the money and the
                reservation.
              </p>
              <div className="row-wrap">
                <ButtonLink href={`/bookings/${booking.publicRef}`} size="sm">
                  Open booking
                </ButtonLink>
                <StatusBadge status={booking.status} />
              </div>
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </div>
  );
}
