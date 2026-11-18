/**
 * Offers — every price rule this organization has written, in every state.
 *
 * Live Deals shows what a consumer can see right now; this is the whole book,
 * including drafts that were never published and offers that ended weeks ago. A
 * merchant deciding what to run next needs the ones that did not work as much as
 * the ones that did.
 *
 * The buttons on each row are rendered from `OFFER_TRANSITIONS` — the same map
 * `transitionOffer` re-checks inside its transaction. So the page cannot offer a
 * move the service would refuse, and a hand-crafted POST asking for one is
 * refused anyway. The map is the specification; this is a rendering of it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  Empty,
  Notice,
  StatusBadge,
  TableScroll,
  formatDateTime,
  formatMoney,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { FilterLinks, PageHeader, Summary } from '@/components/partner/shell';
import { OFFER_TRANSITIONS, listOrganizationOffers, type OfferStatus } from '@/lib/commerce/offers';
import { moveOffer } from './actions';

export const metadata: Metadata = { title: 'Offers' };
export const dynamic = 'force-dynamic';

const STATUSES = Object.keys(OFFER_TRANSITIONS) as OfferStatus[];

function parseStatus(value: string | string[] | undefined): OfferStatus | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const upper = raw.toUpperCase() as OfferStatus;
  return STATUSES.includes(upper) ? upper : null;
}

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ?? null;
}

export default async function OffersPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const query = await searchParams;
  const ctx = await requirePartner('partner.org:read', orgId, `/business/${orgId}/offers`);
  const canWrite = ctx.permissions.has('partner.org:write');

  const status = parseStatus(query.status);
  const rows = await listOrganizationOffers({
    // The guard's id, never params.orgId.
    organizationId: ctx.organizationId,
    status: status ?? undefined,
    limit: 200,
  });

  const base = `/business/${ctx.organizationId}/offers`;
  const error = first(query.error);
  const moved = first(query.moved);

  const live = rows.filter((row) => row.offer.status === 'LIVE').length;
  const redemptions = rows.reduce((sum, row) => sum + row.offer.redeemedCount, 0);
  const now = Date.now();

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Sell"
        title="Offers"
        lede="Every offer this organization has written, newest first. The moves shown on each row are the ones the offer service will accept from its current state."
        actions={
          canWrite ? (
            <ButtonLink href={`/business/${ctx.organizationId}/deals/new`} variant="primary">
              New deal
            </ButtonLink>
          ) : null
        }
      />

      {error ? (
        <Notice tone="bad">
          <span role="alert">{error}</span>
        </Notice>
      ) : null}
      {moved ? (
        <Notice tone="ok">
          <span>Moved to {moved.replace(/_/g, ' ').toLowerCase()}.</span>
        </Notice>
      ) : null}

      <Card>
        <div className="stack stack-4">
          <FilterLinks
            label="Filter offers by status"
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
              { label: 'Offers', value: rows.length },
              { label: 'Live', value: live },
              { label: 'Redemptions', value: redemptions },
            ]}
          />
        </div>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <Empty
            title={status ? `No ${status.replace(/_/g, ' ').toLowerCase()} offers` : 'No offers yet'}
            body={
              status
                ? 'Nothing in this organization currently sits in that state.'
                : 'An offer is a rule that turns a list price into a lower one. Create one against a slot with capacity left.'
            }
            action={
              status ? (
                <Link className="btn btn-sm" href={base}>
                  Clear the filter
                </Link>
              ) : canWrite ? (
                <ButtonLink href={`/business/${ctx.organizationId}/deals/new`} variant="primary">
                  Create a deal
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <>
            <TableScroll>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Offer</th>
                    <th scope="col">Venue</th>
                    <th scope="col">Status</th>
                    <th scope="col">Window</th>
                    <th scope="col" className="table-num">Price</th>
                    <th scope="col" className="table-num">Redeemed</th>
                    <th scope="col">Moves allowed now</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ offer, venue }) => {
                    const allowed = OFFER_TRANSITIONS[offer.status];
                    const saved =
                      offer.listPriceMinor !== null && offer.priceMinor !== null
                        ? Math.max(0, offer.listPriceMinor - offer.priceMinor)
                        : 0;
                    const ended = offer.endsAt.getTime() <= now;

                    return (
                      <tr key={offer.id}>
                        <td>
                          <span style={{ fontWeight: 600 }}>{offer.title}</span>
                          <span className="tiny muted stacked">
                            {offer.kind.replace(/_/g, ' ').toLowerCase()} ·{' '}
                            <span className="mono">{offer.publicRef}</span>
                          </span>
                        </td>
                        <td className="small">
                          {venue ? (
                            <>
                              {venue.name}
                              {venue.locality ? <span className="muted"> · {venue.locality}</span> : null}
                            </>
                          ) : (
                            <span className="muted">All venues</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={offer.status} />
                        </td>
                        <td className="small nowrap">
                          {formatDateTime(offer.startsAt)}
                          <span className="tiny muted stacked">
                            {ended ? 'ended ' : 'ends '}
                            {formatDateTime(offer.endsAt)}
                          </span>
                        </td>
                        <td className="table-num">
                          {offer.priceMinor === null ? (
                            <span className="muted">—</span>
                          ) : (
                            <>
                              {formatMoney(offer.priceMinor, offer.currency)}
                              {saved > 0 ? (
                                <span className="tiny muted stacked">
                                  saves {formatMoney(saved, offer.currency)}
                                </span>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="table-num">
                          {offer.redeemedCount}
                          {offer.maxRedemptions !== null ? (
                            <span className="tiny muted">/{offer.maxRedemptions}</span>
                          ) : null}
                        </td>
                        <td>
                          {allowed.length === 0 ? (
                            <span className="tiny muted">
                              Ended. An offer cannot be resurrected after its terms expired.
                            </span>
                          ) : !canWrite ? (
                            <span className="row-wrap" style={{ gap: 6 }}>
                              {allowed.map((to) => (
                                <Badge key={to} tone="neutral">
                                  {to.replace(/_/g, ' ').toLowerCase()}
                                </Badge>
                              ))}
                            </span>
                          ) : (
                            <span className="row-wrap" style={{ gap: 6 }}>
                              {allowed.map((to) => (
                                <form key={to} action={moveOffer.bind(null, ctx.organizationId)}>
                                  <input type="hidden" name="offerId" value={offer.id} />
                                  <input type="hidden" name="to" value={to} />
                                  <button
                                    type="submit"
                                    className={`btn btn-sm${to === 'LIVE' ? ' btn-primary' : ''}`}
                                  >
                                    {to.replace(/_/g, ' ').toLowerCase()}
                                  </button>
                                </form>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>

            <p className="tiny muted measure-wide">
              {canWrite
                ? 'Each button is a legal move from that offer’s current state. The service re-checks the same map inside its transaction, and refuses to publish an offer whose window has already closed — change the window first.'
                : 'These are the moves your role may see but not make. Changing an offer’s state needs the organization write permission.'}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
