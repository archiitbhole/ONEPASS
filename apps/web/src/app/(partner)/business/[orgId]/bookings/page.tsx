/**
 * Bookings — what was sold, and who turned up.
 *
 * There are no customer names on this page, and that is not an omission. The
 * partner-side booking query deliberately never joins `users` (see
 * listOrganizationBookings) and the business database role cannot read that table
 * at all (src/db/isolation.sql). What identifies a booking here is its
 * `publicRef`; a person behind it is disclosed only through the consent view, and
 * only where a consumer has granted it — which is what the Customers page is for.
 *
 * The status filter lives in the URL rather than in component state, so a filtered
 * view is shareable, survives a reload, and needs no client JavaScript.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { listOrganizationBookings, type BookingStatus } from '@/lib/commerce/booking';
import {
  Card,
  Empty,
  StatusBadge,
  TableScroll,
  formatDateTime,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { ConsentNote, FilterLinks, PageHeader, Summary } from '@/components/partner/shell';

export const metadata: Metadata = { title: 'Bookings' };
export const dynamic = 'force-dynamic';

const STATUSES: BookingStatus[] = [
  'HELD',
  'CONFIRMED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
];

function parseStatus(value: string | string[] | undefined): BookingStatus | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const upper = raw.toUpperCase() as BookingStatus;
  return STATUSES.includes(upper) ? upper : null;
}

export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const query = await searchParams;
  const ctx = await requirePartner('partner.transaction:read', orgId, `/business/${orgId}/bookings`);

  const status = parseStatus(query.status);
  const rows = await listOrganizationBookings({
    // The guard's id, never params.orgId.
    organizationId: ctx.organizationId,
    statuses: status ? [status] : undefined,
    limit: 200,
  });

  const base = `/business/${ctx.organizationId}/bookings`;
  const settled = rows.filter((row) => row.booking.status !== 'CANCELLED' && row.booking.status !== 'EXPIRED');
  const gross = settled.reduce((sum, row) => sum + row.booking.amountMinor, 0);
  const guests = settled.reduce((sum, row) => sum + row.booking.quantity, 0);
  const saved = settled.reduce((sum, row) => sum + row.booking.savedMinor, 0);

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Operate"
        title="Bookings"
        lede="The most recent 200 bookings for this organization, newest first."
      />

      <Card>
        <div className="stack stack-4">
          <FilterLinks
            label="Filter bookings by status"
            current={status}
            options={[
              { href: base, label: 'All', value: null },
              ...STATUSES.map((value) => ({
                href: `${base}?status=${value.toLowerCase()}`,
                label: value.replace(/_/g, ' ').toLowerCase(),
                value,
              })),
            ]}
          />

          <Summary
            items={[
              { label: 'Rows', value: rows.length },
              { label: 'Guests', value: guests },
              { label: 'Gross', value: formatMoney(gross) },
              { label: 'Discounted', value: formatMoney(saved) },
            ]}
          />
        </div>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <Empty
            title={status ? `No ${status.replace(/_/g, ' ').toLowerCase()} bookings` : 'No bookings yet'}
            body={
              status
                ? 'Nothing in this organization currently sits in that state.'
                : 'Bookings appear here the moment capacity is held against one of your slots.'
            }
            action={
              status ? (
                <Link className="btn btn-sm" href={base}>
                  Clear the filter
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Booking</th>
                    <th scope="col">Venue</th>
                    <th scope="col">When</th>
                    <th scope="col" className="table-num">Qty</th>
                    <th scope="col" className="table-num">Amount</th>
                    <th scope="col" className="table-num">Saved</th>
                    <th scope="col">Status</th>
                    <th scope="col">Taken</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ booking, venue }) => (
                    <tr key={booking.id}>
                      <td className="mono nowrap">
                        {booking.publicRef}
                      </td>
                      <td>
                        {venue ? (
                          <>
                            <span style={{ fontWeight: 600 }}>{venue.name}</span>
                            {venue.locality ? <span className="muted"> · {venue.locality}</span> : null}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="nowrap">
                        {booking.startsAt ? formatDateTime(booking.startsAt) : <span className="muted">—</span>}
                      </td>
                      <td className="table-num">{booking.quantity}</td>
                      <td className="table-num">{formatMoney(booking.amountMinor, booking.currency)}</td>
                      <td className="table-num">
                        {booking.savedMinor > 0 ? (
                          formatMoney(booking.savedMinor, booking.currency)
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={booking.status} />
                      </td>
                      <td className="small muted nowrap">
                        {formatRelative(booking.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            <ConsentNote>
              A booking is identified by its reference. The customer&rsquo;s name is not shown here and is
              not readable from this query — identity is disclosed only where that person has granted a
              live consent, and appears on Customers when they have.
            </ConsentNote>
          </>
        )}
      </Card>
    </div>
  );
}
