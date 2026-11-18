/**
 * Create a deal.
 *
 * The candidate slots come from `upcomingSlots`, which is the inventory service's
 * own answer to "what can still be sold" — it already excludes anything past and
 * anything full. Their labels are read back in a second query that re-applies the
 * tenant filter, so a slot id that arrived from anywhere else cannot widen the
 * list.
 */
import type { Metadata } from 'next';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { inventorySlots, venues } from '@/db/schema';
import { upcomingSlots } from '@/lib/commerce/inventory';
import { ButtonLink, Card, CardHead, Empty, Notice } from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { DealForm } from '@/components/partner/deal-form';
import type { SlotOption } from '@/components/partner/deal-state';
import { PageHeader } from '@/components/partner/shell';
import { toIstInputValue } from '@/components/partner/time';
import { createDeal, previewPrice } from './actions';

export const metadata: Metadata = { title: 'New deal' };
export const dynamic = 'force-dynamic';

const MAX_VENUES = 12;
const SLOTS_PER_VENUE = 8;

function whenLabel(startsAt: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(startsAt);
}

export default async function NewDealPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.org:write', orgId, `/business/${orgId}/deals/new`);
  const organizationId = ctx.organizationId;

  const ownVenues = await db
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(and(eq(venues.organizationId, organizationId), eq(venues.isActive, true)))
    .limit(MAX_VENUES);

  const venueNames = new Map(ownVenues.map((venue) => [venue.id, venue.name]));

  const availabilities = (
    await Promise.all(ownVenues.map((venue) => upcomingSlots(venue.id, SLOTS_PER_VENUE)))
  ).flat();

  const slotIds = availabilities.map((slot) => slot.slotId);
  const labelled =
    slotIds.length > 0
      ? await db
          .select({ id: inventorySlots.id, label: inventorySlots.label, venueId: inventorySlots.venueId })
          .from(inventorySlots)
          .where(
            and(
              inArray(inventorySlots.id, slotIds),
              // Re-applied deliberately: `upcomingSlots` is scoped by venue, and the
              // venues were scoped by tenant, but the filter that matters belongs on
              // the row being read.
              eq(inventorySlots.organizationId, organizationId),
            ),
          )
      : [];

  const meta = new Map(labelled.map((row) => [row.id, row]));

  const options: SlotOption[] = availabilities
    .slice()
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .flatMap((slot): SlotOption[] => {
      const row = meta.get(slot.slotId);
      if (!row) return [];
      return [
        {
          slotId: slot.slotId,
          label: row.label,
          venueName: venueNames.get(row.venueId) ?? 'Venue',
          when: whenLabel(slot.startsAt),
          available: slot.available,
          capacity: slot.capacity,
          listPriceMinor: slot.listPriceMinor,
          currency: slot.currency,
        },
      ];
    });

  const now = new Date();
  const defaultEnds = new Date(now.getTime() + 3 * 3_600_000);

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Sell"
        title="New deal"
        lede="Pick unsold capacity, describe the rule, and see what a consumer would pay before you publish."
        actions={<ButtonLink href={`/business/${organizationId}/deals`}>Back to deals</ButtonLink>}
      />

      {options.length === 0 ? (
        <Card>
          <Empty
            title="No sellable capacity"
            body="A deal discounts a capacity slot. Publish a slot with room left at one of your venues and it will appear here."
          />
        </Card>
      ) : (
        <div className="split split-lead">
          <Card>
            <CardHead title="The rule" />
            <DealForm
              slots={options}
              preview={previewPrice.bind(null, organizationId)}
              submit={createDeal.bind(null, organizationId)}
              defaultStartsAt={toIstInputValue(now)}
              defaultEndsAt={toIstInputValue(defaultEnds)}
            />
          </Card>

          <div className="stack stack-4">
            <Card>
              <CardHead title="How the price is decided" />
              <ul className="stack stack-2 small muted" style={{ paddingLeft: 18, margin: 0 }}>
                <li>The list price comes from the slot, never from this form.</li>
                <li>
                  A percentage is rounded <strong>down</strong>, so a consumer is never charged a rounded-up
                  paisa.
                </li>
                <li>A rule that does not reduce the price is refused on save.</li>
                <li>
                  A cap larger than the slot holds is refused — an offer cannot promise capacity that does not
                  exist.
                </li>
              </ul>
            </Card>

            <Notice tone="info">
              <span>
                Saving as a draft changes nothing a consumer can see. Publishing a deal whose window has not
                opened schedules it; it goes live on its own when the window does.
              </span>
            </Notice>
          </div>
        </div>
      )}
    </div>
  );
}
