/**
 * Bookings.
 *
 * A booking is not a ticket: it is the reservation and the money, and it can be held,
 * confirmed, attended or gone. The status badge is the state machine's own word for
 * where it is, taken straight from the row rather than restated in friendlier terms
 * that would drift from what the partner console shows.
 *
 * Holds lead, because a hold is the only row on this screen with a deadline: the
 * capacity goes back to the venue when it lapses, and somebody who cannot see that
 * loses a seat to a screen that was arranged by date. Everything else is a ledger
 * of what happened, grouped by whether it is still ahead of you.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  Empty,
  Money,
  Notice,
  PageHead,
  Stat,
  StatusBadge,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { venueLine } from '@/components/consumer/format';
import { listBookings } from '@/lib/commerce/booking';
import { currentActor } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Bookings',
  description: `Everything you have reserved through ${BRAND.name}.`,
};

export const dynamic = 'force-dynamic';

type Row = Awaited<ReturnType<typeof listBookings>>[number];

function BookingLine({ row, now }: { row: Row; now: Date }) {
  const { booking, venue, offer } = row;
  return (
    <li>
      <span className="ledger-main">
        <Link className="ledger-title" href={`/bookings/${booking.publicRef}`}>
          {venue ? venueLine(venue) : (offer?.title ?? booking.publicRef)}
        </Link>
        <span className="ledger-meta">
          {booking.startsAt ? formatDateTime(booking.startsAt) : `Opened ${formatRelative(booking.createdAt, now)}`}
          {venue && offer?.title ? ` · ${offer.title}` : ''} · <span className="mono">{booking.publicRef}</span>
        </span>
      </span>
      <span className="row-wrap">
        {booking.savedMinor > 0 ? (
          <Badge tone="ok">
            <Glyph name="tag" size={13} />
            saved <Money minor={booking.savedMinor} currency={booking.currency} />
          </Badge>
        ) : null}
        <span className="ledger-figure">
          <Money minor={booking.amountMinor} currency={booking.currency} />
        </span>
        <StatusBadge status={booking.status} />
      </span>
    </li>
  );
}

export default async function BookingsPage() {
  const actor = await currentActor();
  const now = new Date();
  const rows = await listBookings({ userId: actor.userId, limit: 50 });

  const held = rows.filter((r) => r.booking.status === 'HELD');
  const ahead = rows.filter(
    (r) =>
      r.booking.status !== 'HELD' &&
      r.booking.startsAt !== null &&
      r.booking.startsAt.getTime() >= now.getTime() &&
      (r.booking.status === 'CONFIRMED' || r.booking.status === 'CHECKED_IN'),
  );
  const aheadIds = new Set(ahead.map((r) => r.booking.id));
  const behind = rows.filter((r) => r.booking.status !== 'HELD' && !aheadIds.has(r.booking.id));

  const savedMinor = rows.reduce((sum, r) => sum + r.booking.savedMinor, 0);
  const currency = rows[0]?.booking.currency ?? 'INR';

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Reservations"
        title="Bookings"
        lede={
          rows.length > 0
            ? `${rows.length} booking${rows.length === 1 ? '' : 's'} on this account.`
            : `Reservations you make through ${BRAND.name} appear here.`
        }
        actions={
          <ButtonLink href="/tickets" size="sm" variant="ghost">
            The tickets they issued
          </ButtonLink>
        }
      />

      {rows.length > 0 ? (
        <section className="stat-row" aria-label="Bookings at a glance">
          <Stat label="Still to come" value={ahead.length} hint="Confirmed and dated in the future." />
          <Stat
            label="Held"
            value={held.length}
            tone={held.length > 0 ? 'warn' : undefined}
            hint={
              held.length > 0
                ? 'Capacity goes back to the venue when a hold lapses.'
                : 'Nothing is waiting on a payment.'
            }
          />
          <Stat
            label="Saved on these"
            value={<Money minor={savedMinor} currency={currency} />}
            tone="value"
            hint="The difference between the list price and what the booking was written at."
          />
        </section>
      ) : null}

      {held.length > 0 ? (
        <Notice tone="warn">
          <Glyph name="clock" size={18} />
          <span>
            <strong>{held.length}</strong> booking{held.length === 1 ? ' is' : 's are'} still held. A hold returns its
            capacity to the venue when it expires, so finish payment before then.
          </span>
        </Notice>
      ) : null}

      {held.length > 0 ? (
        <section className="stack stack-4" aria-labelledby="held-heading">
          <div className="section-head">
            <h2 id="held-heading">Waiting on you</h2>
          </div>
          <Card>
            <ul className="ledger">
              {held.map((row) => (
                <BookingLine key={row.booking.id} row={row} now={now} />
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <section className="stack stack-4" aria-labelledby="ahead-heading">
        <div className="section-head">
          <h2 id="ahead-heading">Still to come</h2>
        </div>
        {ahead.length > 0 ? (
          <Card>
            <ul className="ledger">
              {ahead.map((row) => (
                <BookingLine key={row.booking.id} row={row} now={now} />
              ))}
            </ul>
          </Card>
        ) : (
          <Card>
            <Empty
              title={rows.length > 0 ? 'Nothing ahead of you' : 'No bookings yet'}
              body={
                rows.length > 0
                  ? 'Every confirmed booking on this account has already happened.'
                  : 'A booking is created the moment you reserve capacity — a seat, a table, a room or a bay.'
              }
              action={
                <ButtonLink href="/deals" variant="primary">
                  See what is live
                </ButtonLink>
              }
            />
          </Card>
        )}
      </section>

      {behind.length > 0 ? (
        <section className="stack stack-4" aria-labelledby="past-heading">
          <div className="section-head">
            <h2 id="past-heading">Behind you</h2>
          </div>
          <Card>
            <ul className="ledger">
              {behind.map((row) => (
                <BookingLine key={row.booking.id} row={row} now={now} />
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
