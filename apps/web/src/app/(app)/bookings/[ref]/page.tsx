/**
 * One booking.
 *
 * The money on this page is the booking's own three figures — list price, amount and
 * saving — read from the row that recorded them at confirmation. Nothing is
 * recomputed here: a detail screen that re-derives a total is a screen that can
 * disagree with the receipt.
 *
 * The states it can still move to come from `BOOKING_TRANSITIONS`, so what the page
 * says is possible is exactly what the service will allow.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  DefinitionList,
  Notice,
  Stack,
  StatusBadge,
  formatDateTime,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { Steps, type StepState } from '@/components/ui';
import { PostAction } from '@/components/consumer/post-action';
import { labelKind } from '@/components/consumer/format';
import { BOOKING_TRANSITIONS, getBooking, selfCancellable } from '@/lib/commerce/booking';
import { listTickets } from '@/lib/commerce/tickets';
import { currentActor } from '../../_queries';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { ref } = await params;
  return { title: `Booking ${ref}` };
}

export default async function BookingPage({ params }: { params: Promise<{ ref: string }> }) {
  const actor = await currentActor();
  const { ref } = await params;

  const found = await getBooking({ publicRef: ref, userId: actor.userId });
  if (!found) notFound();

  const { booking, venue, offer, slot } = found;

  // The ticket, if the booking got far enough to produce one.
  const tickets = await listTickets({ userId: actor.userId, limit: 50 });
  const ticket = tickets.find((t) => t.ticket.bookingId === booking.id)?.ticket ?? null;

  const nextStates = BOOKING_TRANSITIONS[booking.status];
  const cancel = selfCancellable(booking);

  // The progression, drawn from the row rather than from a hand-written happy
  // path: a cancelled or expired booking stops where it stopped, and the stop
  // is marked as such rather than quietly omitted.
  const stopped = booking.status === 'CANCELLED' || booking.status === 'EXPIRED' || booking.status === 'NO_SHOW';
  const reached = (statuses: string[]) => statuses.includes(booking.status);
  const stepState = (done: boolean, current: boolean): StepState =>
    current ? (stopped ? 'failed' : 'current') : done ? 'done' : 'todo';
  const steps = [
    {
      label: 'Held',
      state: stepState(true, booking.status === 'HELD'),
      detail: booking.holdExpiresAt && booking.status === 'HELD' ? formatRelative(booking.holdExpiresAt) : undefined,
    },
    {
      label: 'Confirmed',
      state: stepState(
        reached(['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW']) || booking.confirmedAt !== null,
        booking.status === 'CONFIRMED',
      ),
      detail: booking.confirmedAt ? formatDateTime(booking.confirmedAt) : undefined,
    },
    {
      label: 'At the door',
      state: stepState(reached(['CHECKED_IN', 'COMPLETED']), booking.status === 'CHECKED_IN'),
      detail: booking.checkedInAt ? formatDateTime(booking.checkedInAt) : undefined,
    },
    { label: 'Done', state: stepState(booking.status === 'COMPLETED', booking.status === 'COMPLETED') },
  ];
  const holdExpired =
    booking.status === 'HELD' && booking.holdExpiresAt !== null && booking.holdExpiresAt.getTime() < Date.now();

  return (
    <div className="wrap-narrow">
      <Stack gap={5}>
        <p className="small">
          <Link href="/bookings">← All bookings</Link>
        </p>

        <header>
          <div className="row-wrap" style={{ marginBottom: 8 }}>
            <StatusBadge status={booking.status} />
            {booking.savedMinor > 0 ? (
              <Badge tone="ok">Saved {formatMoney(booking.savedMinor, booking.currency)}</Badge>
            ) : null}
          </div>
          <h1 className="display h1">{venue?.name ?? offer?.title ?? 'Booking'}</h1>
          <p className="lede mono">{booking.publicRef}</p>
        </header>

        {booking.status === 'HELD' ? (
          <Notice tone={holdExpired ? 'bad' : 'warn'}>
            {holdExpired
              ? `This hold expired ${booking.holdExpiresAt ? formatRelative(booking.holdExpiresAt) : ''}. The capacity has gone back to the venue — book again to try for it.`
              : `Held until ${booking.holdExpiresAt ? formatDateTime(booking.holdExpiresAt) : 'payment'}. The place is yours until then and is released automatically after.`}
          </Notice>
        ) : null}

        {booking.status === 'CANCELLED' && booking.cancelledReason ? (
          <Notice tone="neutral">Cancelled — {booking.cancelledReason}</Notice>
        ) : null}

        <Card>
          <Stack gap={4}>
            <Steps label="Where this booking has got to" steps={steps} />
            {stopped ? (
              <p className="small muted">
                This booking stopped at {booking.status.replace(/_/g, ' ').toLowerCase()}; the steps after it never
                happened.
              </p>
            ) : null}
          </Stack>
        </Card>

        <Card>
          <DefinitionList
            items={[
              ['Reference', <span key="r" className="mono">{booking.publicRef}</span>],
              ['Venue', venue ? `${venue.name}${venue.kind ? ` · ${labelKind(venue.kind)}` : ''}` : '—'],
              ...(venue?.locality ? ([['Locality', venue.locality]] as [React.ReactNode, React.ReactNode][]) : []),
              ['Starts', booking.startsAt ? formatDateTime(booking.startsAt) : '—'],
              ['Ends', booking.endsAt ? formatDateTime(booking.endsAt) : '—'],
              ['Quantity', `${booking.quantity} ${slot ? slot.unit.toLowerCase() : 'place'}${booking.quantity === 1 ? '' : 's'}`],
              ...(offer ? ([['Offer', offer.title]] as [React.ReactNode, React.ReactNode][]) : []),
              ['Booked', `${formatDateTime(booking.createdAt)} · ${formatRelative(booking.createdAt)}`],
              ...(booking.confirmedAt
                ? ([['Confirmed', formatDateTime(booking.confirmedAt)]] as [React.ReactNode, React.ReactNode][])
                : []),
              ...(booking.checkedInAt
                ? ([['Checked in', formatDateTime(booking.checkedInAt)]] as [React.ReactNode, React.ReactNode][])
                : []),
              ...(booking.guestNote
                ? ([['Your note', booking.guestNote]] as [React.ReactNode, React.ReactNode][])
                : []),
            ]}
          />
        </Card>

        <Card>
          <Stack gap={3}>
            <h2 className="h3">What it cost</h2>
            <DefinitionList
              items={[
                ['List price', formatMoney(booking.listPriceMinor, booking.currency)],
                ['You paid', formatMoney(booking.amountMinor, booking.currency)],
                [
                  'You saved',
                  booking.savedMinor > 0 ? (
                    <span key="s" style={{ color: 'var(--ok)' }}>
                      {formatMoney(booking.savedMinor, booking.currency)}
                    </span>
                  ) : (
                    '—'
                  ),
                ],
                ...(booking.pointsSpent > 0
                  ? ([['Points spent', booking.pointsSpent.toLocaleString('en-IN')]] as [
                      React.ReactNode,
                      React.ReactNode,
                    ][])
                  : []),
              ]}
            />
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <h2 className="h3">Your ticket</h2>
            {ticket ? (
              <>
                <p className="small muted">
                  Issued as <span className="mono">{ticket.publicRef}</span> — this is the code the door scans.
                </p>
                <div className="row-wrap">
                  <ButtonLink href={`/tickets/${ticket.publicRef}`} variant="primary">
                    Open ticket
                  </ButtonLink>
                  <StatusBadge status={ticket.state} />
                </div>
              </>
            ) : (
              <p className="small muted">
                A ticket is issued when the booking is confirmed. There is none against this booking yet.
              </p>
            )}
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <h2 className="h3">Cancelling</h2>
            {cancel.allowed ? (
              <>
                <p className="small muted">
                  {booking.status === 'HELD'
                    ? 'Giving up this hold releases the place back to the venue straight away. No money has been taken for it.'
                    : 'This booking cost nothing, so cancelling it releases the place and voids the ticket. Nothing is refunded because nothing was paid.'}
                </p>
                <PostAction
                  path={`/api/me/bookings/${booking.publicRef}/cancel`}
                  body={{ reason: 'Cancelled by the person who booked it' }}
                  label="Cancel this booking"
                  pendingLabel="Cancelling…"
                  successMessage="Cancelled. The place has gone back to the venue and any ticket against it is void."
                  variant="danger"
                  confirm="Cancel this booking? The place goes back to the venue immediately."
                />
              </>
            ) : (
              <p className="small muted">
                {cancel.reason === 'PAYMENT_ATTACHED'
                  ? `This booking has a payment against it, so it cannot be cancelled here — ${venue?.name ?? 'the venue'} decides what happens to money they have taken. Ask them, or open a return on the receipt if one was issued.`
                  : cancel.reason === 'POINTS_SPENT'
                    ? `Points were spent on this booking. ${venue?.name ?? 'The venue'} has to reverse it, because returning the points and releasing the place is one decision, not two.`
                    : cancel.reason === 'CHECKED_IN'
                      ? 'This booking has already been used at the door.'
                      : `This booking is ${booking.status.replace(/_/g, ' ').toLowerCase()} — there is nothing left to cancel.`}
              </p>
            )}
          </Stack>
        </Card>

        <Card className="card-flat">
          <Stack gap={2}>
            <p className="eyebrow">Where this can go next</p>
            {nextStates.length > 0 ? (
              <div className="row-wrap">
                {nextStates.map((state) => (
                  <StatusBadge key={state} status={state} />
                ))}
              </div>
            ) : (
              <p className="small muted">This booking is finished — {booking.status.toLowerCase()} is a final state.</p>
            )}
            <p className="tiny muted">
              These are the moves the booking service will accept from {booking.status.toLowerCase()}. Checking in is
              done by the venue at the door.
            </p>
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}
