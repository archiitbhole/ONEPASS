/**
 * Live Deals — what is running right now, and how long it has left.
 *
 * Remaining capacity is read from the slot's own three counters through
 * `availabilityOf` rather than from the offer's redemption count: an offer can be
 * redeemed against a slot that other channels are also selling, and the number a
 * merchant needs at 7pm is "what is left to sell", not "how many of my coupons
 * went". A deal with no capacity left is shown as sold out rather than hidden,
 * because the merchant is the one who has to decide what to do about it.
 */
import type { Metadata } from 'next';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { inventorySlots, offers, venues } from '@/db/schema';
import { availabilityOf } from '@/lib/commerce/inventory';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  Empty,
  StatusBadge,
  formatDateTime,
  formatMoney,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { CapacityBar, CapacityLegend } from '@/components/partner/charts';
import { Countdown } from '@/components/partner/countdown';
import { PageHeader } from '@/components/partner/shell';
import { formatCountdown } from '@/components/partner/time';

export const metadata: Metadata = { title: 'Live Deals' };
export const dynamic = 'force-dynamic';

export default async function DealsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.org:read', orgId, `/business/${orgId}/deals`);
  const canPublish = ctx.permissions.has('partner.org:write');
  const now = new Date();

  const rows = await db
    .select({ offer: offers, slot: inventorySlots, venue: venues })
    .from(offers)
    .leftJoin(inventorySlots, eq(inventorySlots.id, offers.slotId))
    .leftJoin(venues, eq(venues.id, offers.venueId))
    .where(and(eq(offers.organizationId, ctx.organizationId), inArray(offers.status, ['LIVE', 'SCHEDULED'])))
    .orderBy(asc(offers.endsAt))
    .limit(60);

  const live = rows.filter((row) => row.offer.status === 'LIVE');
  const scheduled = rows.filter((row) => row.offer.status === 'SCHEDULED');

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Sell"
        title="Live Deals"
        lede="Deals expiring soonest first — the order that makes the section feel live for a consumer, and the order that tells you what needs a decision."
        actions={
          canPublish ? (
            <ButtonLink href={`/business/${ctx.organizationId}/deals/new`} variant="primary">
              New deal
            </ButtonLink>
          ) : null
        }
      />

      {live.length === 0 ? (
        <Card>
          <Empty
            title="Nothing live right now"
            body={
              canPublish
                ? 'Create a deal against a slot with capacity left, set a window, and publish it.'
                : 'A deal appears here as soon as someone on your team publishes one.'
            }
            action={
              canPublish ? (
                <ButtonLink href={`/business/${ctx.organizationId}/deals/new`} variant="primary">
                  Create a deal
                </ButtonLink>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="stack stack-4">
          <CapacityLegend />
          <div className="grid grid-2">
            {live.map(({ offer, slot, venue }) => {
              const availability = slot ? availabilityOf(slot) : null;
              const list = offer.listPriceMinor ?? slot?.listPriceMinor ?? null;
              const price = offer.priceMinor;
              const saved = list !== null && price !== null ? Math.max(0, list - price) : 0;
              const msLeft = offer.endsAt.getTime() - now.getTime();
              const soldOut = availability !== null && availability.available <= 0;

              return (
                <Card key={offer.id} as="article">
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div className="grow">
                      <p className="eyebrow">{offer.kind.replace(/_/g, ' ').toLowerCase()}</p>
                      <h2 className="h3" style={{ marginTop: 4 }}>
                        {offer.title}
                      </h2>
                      <p className="small muted" style={{ marginTop: 4 }}>
                        {venue ? venue.name : 'All venues'}
                        {venue?.locality ? ` · ${venue.locality}` : ''}
                        {slot ? ` · ${slot.label}` : ''}
                      </p>
                    </div>
                    {soldOut ? <Badge tone="accent">sold out</Badge> : <StatusBadge status={offer.status} />}
                  </div>

                  <div className="row-between" style={{ marginTop: 16, alignItems: 'baseline' }}>
                    <p className="num">{price === null ? '—' : formatMoney(price, offer.currency)}</p>
                    {list !== null && saved > 0 ? (
                      <p className="small muted">
                        <s>{formatMoney(list, offer.currency)}</s> · saves {formatMoney(saved, offer.currency)}
                      </p>
                    ) : null}
                  </div>

                  {availability ? (
                    <div className="stack stack-2" style={{ marginTop: 16 }}>
                      <CapacityBar
                        capacity={availability.capacity}
                        held={availability.held}
                        sold={availability.sold}
                      />
                      <p className="tiny muted">
                        {availability.available} of {availability.capacity} left · {availability.sold} sold ·{' '}
                        {availability.held} held in checkout
                      </p>
                    </div>
                  ) : (
                    <p className="tiny muted" style={{ marginTop: 16 }}>
                      Not tied to a capacity slot — this deal does not consume inventory.
                    </p>
                  )}

                  <hr className="divider" style={{ marginBlock: 16 }} />

                  <div className="row-between">
                    <span className="small muted">
                      ends {formatDateTime(offer.endsAt)}
                      {offer.maxRedemptions !== null
                        ? ` · ${offer.redeemedCount}/${offer.maxRedemptions} claimed`
                        : ` · ${offer.redeemedCount} claimed`}
                    </span>
                    <span className={`badge badge-${msLeft < 3_600_000 ? 'warn' : 'info'}`}>
                      <Countdown endsAt={offer.endsAt.toISOString()} initial={formatCountdown(msLeft)} />
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {scheduled.length > 0 ? (
        <Card>
          <CardHead title="Scheduled" action={<span className="small muted">Not yet visible to consumers</span>} />
          <ul className="stack stack-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {scheduled.map(({ offer, venue }) => (
              <li key={offer.id} className="row-between card-flat">
                <span>
                  <strong>{offer.title}</strong>
                  <span className="muted small"> · {venue?.name ?? 'All venues'}</span>
                </span>
                <span className="small muted">
                  starts {formatDateTime(offer.startsAt)} · ends {formatDateTime(offer.endsAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
