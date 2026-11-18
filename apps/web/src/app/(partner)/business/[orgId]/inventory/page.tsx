/**
 * Inventory — capacity, and the three counters that make it honest.
 *
 * `capacity`, `heldCount` and `soldCount` are shown separately rather than as one
 * percentage because they mean different things to whoever is looking: sold is
 * money taken, held is a checkout in flight that may still lapse and return the
 * seat, and available is what can be sold in the next ten minutes. Availability is
 * derived by `availabilityOf`, the same function the booking path uses, so this
 * page cannot disagree with what a consumer is allowed to buy.
 *
 * Sold-out and past-today slots are shown, not filtered away: a merchant deciding
 * what to discount needs to see what did not sell.
 */
import type { Metadata } from 'next';
import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '@/db/client';
import { inventorySlots, venues } from '@/db/schema';
import { availabilityOf } from '@/lib/commerce/inventory';
import { Badge, Card, CardHead, Empty, TableScroll, formatDateTime, formatMoney } from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { CapacityBar, CapacityLegend } from '@/components/partner/charts';
import { PageHeader, Summary } from '@/components/partner/shell';
import { startOfBusinessDay } from '@/components/partner/time';

export const metadata: Metadata = { title: 'Inventory' };
export const dynamic = 'force-dynamic';

export default async function InventoryPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.org:read', orgId, `/business/${orgId}/inventory`);
  const organizationId = ctx.organizationId;

  const rows = await db
    .select({ slot: inventorySlots, venueName: venues.name, venueLocality: venues.locality })
    .from(inventorySlots)
    .leftJoin(venues, eq(venues.id, inventorySlots.venueId))
    .where(
      and(
        eq(inventorySlots.organizationId, organizationId),
        // From the start of today onward: yesterday's capacity is history, and a
        // console that lists it makes today harder to find.
        gte(inventorySlots.endsAt, startOfBusinessDay()),
      ),
    )
    .orderBy(asc(inventorySlots.startsAt))
    .limit(300);

  const byVenue = new Map<string, { name: string; locality: string | null; slots: typeof rows }>();
  for (const row of rows) {
    const key = row.slot.venueId;
    const existing = byVenue.get(key);
    if (existing) existing.slots.push(row);
    else byVenue.set(key, { name: row.venueName ?? 'Unnamed venue', locality: row.venueLocality, slots: [row] });
  }

  const totals = rows.reduce(
    (acc, row) => {
      const availability = availabilityOf(row.slot);
      acc.capacity += availability.capacity;
      acc.held += availability.held;
      acc.sold += availability.sold;
      acc.available += availability.available;
      return acc;
    },
    { capacity: 0, held: 0, sold: 0, available: 0 },
  );

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Sell"
        title="Inventory"
        lede="Published capacity from today onward. Availability is capacity minus held minus sold — the same arithmetic the booking path locks a row to perform."
      />

      <Card>
        <div className="stack stack-3">
          <Summary
            items={[
              { label: 'Slots', value: rows.length },
              { label: 'Capacity', value: totals.capacity },
              { label: 'Sold', value: totals.sold },
              { label: 'Held', value: totals.held },
              { label: 'Available', value: totals.available },
              {
                label: 'Utilisation',
                value: totals.capacity > 0 ? `${Math.round((totals.sold / totals.capacity) * 100)}%` : '—',
              },
            ]}
          />
          <CapacityLegend />
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <Empty
            title="No capacity published"
            body="Slots created for this organization's venues appear here, grouped by venue."
          />
        </Card>
      ) : (
        [...byVenue.entries()].map(([venueId, venue]) => (
          <Card key={venueId}>
            <CardHead
              title={
                <>
                  {venue.name}
                  {venue.locality ? <span className="muted small"> · {venue.locality}</span> : null}
                </>
              }
              action={<span className="small muted">{venue.slots.length} slots</span>}
            />
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Slot</th>
                    <th scope="col">Window</th>
                    <th scope="col">Unit</th>
                    <th scope="col" style={{ minWidth: 160 }}>Fill</th>
                    <th scope="col" className="table-num">Sold</th>
                    <th scope="col" className="table-num">Held</th>
                    <th scope="col" className="table-num">Left</th>
                    <th scope="col" className="table-num">Capacity</th>
                    <th scope="col" className="table-num">List price</th>
                  </tr>
                </thead>
                <tbody>
                  {venue.slots.map(({ slot }) => {
                    const availability = availabilityOf(slot);
                    return (
                      <tr key={slot.id}>
                        <td style={{ fontWeight: 600 }}>{slot.label}</td>
                        <td className="nowrap">{formatDateTime(slot.startsAt)}</td>
                        <td className="small muted">{slot.unit.toLowerCase()}</td>
                        <td>
                          <CapacityBar
                            capacity={availability.capacity}
                            held={availability.held}
                            sold={availability.sold}
                          />
                        </td>
                        <td className="table-num">{availability.sold}</td>
                        <td className="table-num">{availability.held}</td>
                        <td className="table-num">
                          {availability.available === 0 ? (
                            <Badge tone="accent">sold out</Badge>
                          ) : (
                            availability.available
                          )}
                        </td>
                        <td className="table-num">{availability.capacity}</td>
                        <td className="table-num">
                          {formatMoney(availability.listPriceMinor, availability.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        ))
      )}
    </div>
  );
}
