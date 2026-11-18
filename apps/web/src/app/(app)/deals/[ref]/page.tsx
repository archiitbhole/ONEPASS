/**
 * One deal.
 *
 * The shape is the app's `object-detail`: the thing on the left, what it costs
 * and the control to take it on the right, sticky where there is room. A deal is
 * a place and a window, so the object is a poster drawn from the offer's own
 * public reference — we have no photograph of the venue, and a stock one would
 * imply a room looks like something it may not.
 *
 * **The price is a breakdown, not a figure.** The brief this product is built to
 * forbids advertising a low price and revealing mandatory charges later, so the
 * card prints every component of what will be charged — and the honest answer
 * today is that there are none beyond the ticket: `holdBooking` prices a hold as
 * unit × quantity from the slot's list price and the offer's price, and
 * `issueReceiptForCheckout` writes the receipt at `taxRateBp: 0` because nothing
 * in the model holds a tax breakdown for a booking. So the lines say "no booking
 * fee" and "no service charge" out loud rather than leaving a person to wonder
 * what will appear at the payment sheet.
 *
 * Nothing here is recomputed. The price stored on the offer was computed from
 * the slot's list price when the offer was created; the remaining count is read
 * from the slot, which is the only row that knows how much capacity is left.
 * Neither is ever accepted from the URL.
 *
 * Booking posts to `/api/checkout/begin`, which resolves this offer's public
 * reference server-side, takes the hold and opens one provider order. Whether
 * the payment then succeeded is not decided here or anywhere else the browser
 * can reach: the signed provider callback at `/api/webhooks/payments` is the
 * only thing that captures.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Card,
  DefinitionList,
  Meter,
  Money,
  Notice,
  PageHead,
  formatDateTime,
  formatMoney,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { Poster } from '@/components/objects';
import { FeatureNote } from '@/components/system';
import { Countdown } from '@/components/consumer/countdown';
import { PostAction } from '@/components/consumer/post-action';
import { labelKind, venueLine } from '@/components/consumer/format';
import { currentActor, offerDetail } from '../../_queries';
import { BRAND } from '@/lib/brand';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { ref } = await params;
  const found = await offerDetail(ref);
  return {
    title: found ? found.offer.title : 'Deal not found',
    description: found?.offer.description ?? `A ${BRAND.name} partner offer.`,
  };
}

export default async function DealPage({ params }: { params: Promise<{ ref: string }> }) {
  await currentActor();
  const { ref } = await params;

  const found = await offerDetail(ref);
  if (!found) notFound();

  const { offer, venue, slot, organization, city } = found;
  const now = new Date();
  const live = offer.status === 'LIVE' && offer.endsAt > now && offer.startsAt <= now;
  const remaining = slot ? Math.max(0, slot.capacity - slot.heldCount - slot.soldCount) : null;
  const savedMinor =
    offer.listPriceMinor !== null && offer.priceMinor !== null
      ? Math.max(0, offer.listPriceMinor - offer.priceMinor)
      : 0;

  const bookable = live && (remaining === null || remaining > 0);
  const blockedReason = !live
    ? offer.endsAt <= now
      ? 'This deal has ended. The capacity behind it went back to the venue.'
      : offer.startsAt > now
        ? `This deal opens ${formatDateTime(offer.startsAt)}.`
        : `This deal is ${offer.status.toLowerCase().replace(/_/g, ' ')}.`
    : remaining === 0
      ? 'Every place on this deal has gone.'
      : null;

  const secondsRemaining = Math.max(0, Math.floor((offer.endsAt.getTime() - now.getTime()) / 1000));

  return (
    <div className="wrap stack stack-5">
      <p className="small">
        <Link href="/deals">← All live deals</Link>
      </p>

      <PageHead
        eyebrow={venue ? labelKind(venue.kind) : undefined}
        title={offer.title}
        lede={
          venue ? `${venueLine(venue)}${city && !venue.name.includes(city.name) ? ` · ${city.name}` : ''}` : undefined
        }
        actions={
          /* Only while it is actually live. A ticking clock beside an offer that
             already ended counts down to nothing, and a clock on one that has not
             opened counts the wrong interval — the window is stated in full in the
             details either way. */
          live ? <Countdown endsAt={offer.endsAt.toISOString()} secondsRemaining={secondsRemaining} /> : null
        }
      />

      <div className="object-detail">
        {/* ── the deal itself ── */}
        <div className="stack stack-4">
          <Poster
            kind={venue?.kind ?? 'EVENT'}
            seed={offer.publicRef}
            city={city?.name ?? venue?.locality ?? null}
            ratio="16 / 9"
          />

          {offer.description ? <p className="lede">{offer.description}</p> : null}

          <Card>
            <div className="stack stack-3">
              <h2 className="h3">What you are booking</h2>
              <DefinitionList
                items={[
                  ['Merchant', organization?.name ?? '—'],
                  ['Venue', venue ? `${venue.name}${venue.kind ? ` · ${labelKind(venue.kind)}` : ''}` : '—'],
                  ...(slot
                    ? ([
                        ['Session', `${formatDateTime(slot.startsAt)} → ${formatDateTime(slot.endsAt)}`],
                        ['Sold by the', slot.unit.toLowerCase()],
                      ] as [React.ReactNode, React.ReactNode][])
                    : []),
                  ['Deal window', `${formatDateTime(offer.startsAt)} → ${formatDateTime(offer.endsAt)}`],
                  ['Limit', offer.maxPerUser === 1 ? 'One per person' : `${offer.maxPerUser} per person`],
                  ...(offer.maxRedemptions !== null
                    ? ([['Claimed', `${offer.redeemedCount} of ${offer.maxRedemptions}`]] as [
                        React.ReactNode,
                        React.ReactNode,
                      ][])
                    : []),
                  ['Offer reference', <span key="r" className="mono">{offer.publicRef}</span>],
                ]}
              />
            </div>
          </Card>

          {slot ? (
            <Card className="card-sunken">
              <div className="stack stack-3">
                <div className="row-between">
                  <h2 className="h4">Capacity</h2>
                  <span className="tiny muted">
                    {slot.capacity - (remaining ?? 0)} of {slot.capacity} taken
                  </span>
                </div>
                <Meter
                  value={slot.capacity - (remaining ?? 0)}
                  max={slot.capacity}
                  label={`${remaining ?? 0} of ${slot.capacity} places left on this deal`}
                  {...(remaining !== null && remaining <= 5 ? ({ tone: 'warn' } as const) : {})}
                />
                <p className="tiny muted">
                  Counted from the slot: capacity less what is held and what is sold. A place somebody is
                  holding is already out of this figure, so nobody can be sold the same seat twice.
                </p>
              </div>
            </Card>
          ) : null}

          {offer.terms ? (
            <Card>
              <div className="stack stack-2">
                <h2 className="h3">Terms</h2>
                <p className="small muted">{offer.terms}</p>
              </div>
            </Card>
          ) : null}
        </div>

        {/* ── what it costs, and taking it ── */}
        <aside className="object-detail-aside">
          <Card className="card-lift">
            <div className="stack stack-4">
              <div>
                <p className="eyebrow">You pay</p>
                <p className="figure-lg">
                  {offer.priceMinor !== null ? (
                    <Money minor={offer.priceMinor} currency={offer.currency} />
                  ) : (
                    'Points only'
                  )}
                </p>
              </div>

              {/* Every component of the charge, before the button rather than
                  after it. The "none" lines are the point: they are what a
                  person has been trained to expect at the payment sheet. */}
              <dl className="breakdown">
                {offer.listPriceMinor !== null ? (
                  <div>
                    <dt>Venue&rsquo;s list price</dt>
                    <dd className="deal-was">{formatMoney(offer.listPriceMinor, offer.currency)}</dd>
                  </div>
                ) : null}
                {savedMinor > 0 ? (
                  <div>
                    <dt>Off, on this deal</dt>
                    <dd className="value-text">−{formatMoney(savedMinor, offer.currency)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{BRAND.name} booking fee</dt>
                  <dd>None</dd>
                </div>
                <div>
                  <dt>Service charge</dt>
                  <dd>None</dd>
                </div>
                <div>
                  <dt>Tax added on top</dt>
                  <dd>None</dd>
                </div>
                <div className="breakdown-total">
                  <dt>Total for one</dt>
                  <dd>
                    {offer.priceMinor !== null ? formatMoney(offer.priceMinor, offer.currency) : 'Points only'}
                  </dd>
                </div>
              </dl>

              {bookable ? (
                <PostAction
                  path="/api/checkout/begin"
                  body={{
                    offerRef: offer.publicRef,
                    quantity: 1,
                    // Generated per rendered page: a double-tapped button reuses the
                    // same key, which is what makes the retry harmless rather than a
                    // second hold on the same seat.
                    idempotencyKey: `web:${offer.publicRef}:${crypto.randomUUID()}`,
                  }}
                  label={`Book for ${offer.priceMinor !== null ? formatMoney(offer.priceMinor, offer.currency) : 'points'}`}
                  pendingLabel="Holding your place…"
                  successMessage="Held. Your booking is in Bookings until payment is captured."
                  size="lg"
                  block
                />
              ) : (
                <Notice tone="neutral">{blockedReason}</Notice>
              )}

              <p className="tiny muted">
                Booking holds capacity for a few minutes and opens one payment. Nothing is charged until the
                payment is captured, and an abandoned hold returns the place to the venue.
              </p>
            </div>
          </Card>

          <Card className="card-sunken">
            <div className="stack stack-3">
              <p className="small">
                <Glyph name="shield" size={15} /> The amount is computed on the server from the offer and the
                slot. There is no field in this request a price could be put in, and the browser is never
                asked whether a payment succeeded.
              </p>
              <FeatureNote featureKey="checkout" />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
