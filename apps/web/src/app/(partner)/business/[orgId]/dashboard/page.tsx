/**
 * The dashboard — today, and the fortnight behind it.
 *
 * Every number here is an aggregate over this organization's own rows: revenue is
 * summed from captured `transactions`, attendance from `bookings.checkedInAt`,
 * utilisation from the three counters on `inventory_slots`. Nothing is modelled,
 * projected or smoothed, so there is nothing on this page that needs an estimate
 * label — and nothing that a merchant cannot reconcile against a query.
 *
 * The trading day is Asia/Kolkata, not the server's clock. See components/partner/time.ts.
 */
import type { Metadata } from 'next';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ts } from '@/db/sql-helpers';
import { bookings, inventorySlots, transactions, venues } from '@/db/schema';
import {
  Card,
  CardHead,
  Empty,
  Stat,
  StatRow,
  TableScroll,
  formatMoney,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { PageHeader } from '@/components/partner/shell';
import { LiveRefresh } from '@/components/realtime/live-refresh';
import { CapacityBar, Sparkline, type SeriesPoint } from '@/components/partner/charts';
import { businessDayKey, labelForDayKey, startOfBusinessDay, startOfBusinessDaysAgo } from '@/components/partner/time';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const SETTLED: ('CONFIRMED' | 'CHECKED_IN' | 'COMPLETED')[] = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'];
const SERIES_DAYS = 14;

export default async function DashboardPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.analytics:read', orgId, `/business/${orgId}/dashboard`);
  const organizationId = ctx.organizationId;

  const dayStart = startOfBusinessDay();
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const seriesFrom = startOfBusinessDaysAgo(SERIES_DAYS - 1);
  const monthFrom = startOfBusinessDaysAgo(29);

  /** Captured payments are the only thing counted as revenue. An authorization is not money. */
  const paidAt = sql`coalesce(${transactions.capturedAt}, ${transactions.createdAt})`;

  const [todayMoney] = await db
    .select({
      revenueMinor: sql<string>`coalesce(sum(${transactions.amountMinor}), 0)::bigint`,
      payments: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, organizationId),
        eq(transactions.status, 'CAPTURED'),
        sql`${paidAt} >= ${ts(dayStart)}`,
        sql`${paidAt} < ${ts(dayEnd)}`,
      ),
    );

  const [todayBookings] = await db
    .select({
      taken: sql<number>`cast(count(*) filter (where ${bookings.createdAt} >= ${ts(dayStart)}) as int)`,
      checkedIn: sql<number>`cast(count(*) filter (where ${bookings.checkedInAt} >= ${ts(dayStart)}) as int)`,
      expected: sql<number>`cast(count(*) filter (where ${bookings.startsAt} >= ${ts(dayStart)} and ${bookings.startsAt} < ${ts(dayEnd)} and ${bookings.status} in ('CONFIRMED','CHECKED_IN','COMPLETED')) as int)`,
      guests: sql<number>`cast(coalesce(sum(${bookings.quantity}) filter (where ${bookings.checkedInAt} >= ${ts(dayStart)}), 0) as int)`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.organizationId, organizationId),
        sql`(${bookings.createdAt} >= ${ts(dayStart)} or ${bookings.checkedInAt} >= ${ts(dayStart)} or (${bookings.startsAt} >= ${ts(dayStart)} and ${bookings.startsAt} < ${ts(dayEnd)}))`,
      ),
    );

  const [todayCapacity] = await db
    .select({
      slots: sql<number>`count(*)::int`,
      capacity: sql<number>`cast(coalesce(sum(${inventorySlots.capacity}), 0) as int)`,
      held: sql<number>`cast(coalesce(sum(${inventorySlots.heldCount}), 0) as int)`,
      sold: sql<number>`cast(coalesce(sum(${inventorySlots.soldCount}), 0) as int)`,
    })
    .from(inventorySlots)
    .where(
      and(
        eq(inventorySlots.organizationId, organizationId),
        lt(inventorySlots.startsAt, dayEnd),
        gte(inventorySlots.endsAt, dayStart),
      ),
    );

  // One row per trading day that actually took money. Missing days are filled with
  // a real zero below rather than being interpolated across.
  const dayBucket = sql`date_trunc('day', ${paidAt} at time zone 'Asia/Kolkata')`;
  const seriesRows = await db
    .select({
      day: sql<string>`to_char(${dayBucket}, 'YYYY-MM-DD')`,
      totalMinor: sql<string>`coalesce(sum(${transactions.amountMinor}), 0)::bigint`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, organizationId),
        eq(transactions.status, 'CAPTURED'),
        sql`${paidAt} >= ${ts(seriesFrom)}`,
      ),
    )
    .groupBy(dayBucket)
    .orderBy(dayBucket);

  const byDay = new Map(seriesRows.map((row) => [row.day, Number(row.totalMinor)]));
  const series: SeriesPoint[] = Array.from({ length: SERIES_DAYS }, (_, i) => {
    const key = businessDayKey(new Date(seriesFrom.getTime() + i * 86_400_000));
    return { key, label: labelForDayKey(key), value: byDay.get(key) ?? 0 };
  });
  const fortnightTotal = series.reduce((sum, point) => sum + point.value, 0);

  const topVenues = await db
    .select({
      venueId: venues.id,
      name: venues.name,
      kind: venues.kind,
      locality: venues.locality,
      count: sql<number>`count(*)::int`,
      guests: sql<number>`cast(coalesce(sum(${bookings.quantity}), 0) as int)`,
      revenueMinor: sql<string>`coalesce(sum(${bookings.amountMinor}), 0)::bigint`,
    })
    .from(bookings)
    .innerJoin(venues, eq(venues.id, bookings.venueId))
    .where(
      and(
        eq(bookings.organizationId, organizationId),
        // The venue is scoped too: a join is not a filter, and a venue row that
        // belonged to someone else would otherwise ride in on a stale foreign key.
        eq(venues.organizationId, organizationId),
        gte(bookings.createdAt, monthFrom),
        inArray(bookings.status, SETTLED),
      ),
    )
    .groupBy(venues.id, venues.name, venues.kind, venues.locality)
    .orderBy(sql`coalesce(sum(${bookings.amountMinor}), 0) desc`)
    .limit(6);

  const capacity = todayCapacity?.capacity ?? 0;
  const sold = todayCapacity?.sold ?? 0;
  const held = todayCapacity?.held ?? 0;
  const utilisation = capacity > 0 ? Math.round((sold / capacity) * 100) : null;
  const expected = todayBookings?.expected ?? 0;
  const checkedIn = todayBookings?.checkedIn ?? 0;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Today"
        title={ctx.membership?.organizationName ?? 'Dashboard'}
        lede="Trading day runs midnight to midnight, Asia/Kolkata. Revenue counts captured payments only — an authorization that never captured is not money."
        actions={
          <LiveRefresh
            types={['BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'TICKET_ADMITTED', 'PAYMENT_COMPLETED']}
            noun="update"
          />
        }
      />

      <StatRow>
        <Stat
          label="Revenue today"
          value={formatMoney(Number(todayMoney?.revenueMinor ?? 0))}
          hint={`${todayMoney?.payments ?? 0} captured ${todayMoney?.payments === 1 ? 'payment' : 'payments'}`}
        />
        <Stat
          label="Bookings taken"
          value={todayBookings?.taken ?? 0}
          hint={`${expected} due to arrive today`}
        />
        <Stat
          label="Checked in"
          value={checkedIn}
          hint={
            expected > 0
              ? `${Math.round((checkedIn / expected) * 100)}% of those expected · ${todayBookings?.guests ?? 0} guests`
              : `${todayBookings?.guests ?? 0} guests through the door`
          }
          tone={expected > 0 && checkedIn === 0 ? 'warn' : undefined}
        />
        <Stat
          label="Utilisation"
          value={utilisation === null ? '—' : `${utilisation}%`}
          hint={
            capacity > 0
              ? `${sold} sold, ${held} held of ${capacity} across ${todayCapacity?.slots ?? 0} slots`
              : 'No capacity published for today'
          }
        />
      </StatRow>

      <Card>
        <CardHead
          title="Revenue, last 14 days"
          action={<span className="small muted">{formatMoney(fortnightTotal)} total</span>}
        />
        {fortnightTotal === 0 ? (
          <Empty
            title="No captured payments in the last 14 days"
            body="The line appears as soon as a payment is captured against this organization."
          />
        ) : (
          <Sparkline series={series} ariaLabel="Captured revenue per day over the last 14 days" />
        )}
      </Card>

      <div className="split split-wide">
        <Card>
          <CardHead title="Top venues" action={<span className="small muted">Last 30 days</span>} />
          {topVenues.length === 0 ? (
            <Empty
              title="No settled bookings in the last 30 days"
              body="Venues appear here once a booking at them is confirmed."
            />
          ) : (
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Venue</th>
                    <th scope="col">Kind</th>
                    <th scope="col" className="table-num">Bookings</th>
                    <th scope="col" className="table-num">Guests</th>
                    <th scope="col" className="table-num">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {topVenues.map((venue) => (
                    <tr key={venue.venueId}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{venue.name}</span>
                        {venue.locality ? <span className="muted"> · {venue.locality}</span> : null}
                      </td>
                      <td className="small muted">{venue.kind.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="table-num">{venue.count}</td>
                      <td className="table-num">{venue.guests}</td>
                      <td className="table-num">{formatMoney(Number(venue.revenueMinor))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>

        <Card>
          <CardHead title="Capacity today" />
          {capacity === 0 ? (
            <Empty title="Nothing published" body="No inventory slot overlaps today." />
          ) : (
            <div className="stack stack-3">
              <CapacityBar capacity={capacity} held={held} sold={sold} />
              <dl className="dl">
                <div>
                  <dt>Sold</dt>
                  <dd className="mono">{sold}</dd>
                </div>
                <div>
                  <dt>Held in checkout</dt>
                  <dd className="mono">{held}</dd>
                </div>
                <div>
                  <dt>Still available</dt>
                  <dd className="mono">{Math.max(0, capacity - held - sold)}</dd>
                </div>
                <div>
                  <dt>Published capacity</dt>
                  <dd className="mono">{capacity}</dd>
                </div>
              </dl>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
