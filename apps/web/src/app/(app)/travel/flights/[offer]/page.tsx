/**
 * One fare, in full, before anybody commits to it.
 *
 * The results page shows enough to choose between fares; this page shows enough
 * to decide on one. Every leg with its own times and aircraft, the connection
 * time written out, the price broken into its parts, and the airline's own fare
 * rules and baggage allowance fetched from the provider rather than guessed.
 *
 * **Fare rules are the provider's words, rendered verbatim.** They are the terms
 * somebody is agreeing to, and summarising them into "flexible" or "saver" is
 * how a customer discovers a ₹3,000 change fee at the airport. Where the
 * provider says nothing, the page says the provider said nothing.
 *
 * **The total is the total.** Every mandatory charge has its own line and the
 * last line is their sum — there is no "other charges" row because there is
 * nowhere in the calculation for a charge to go without a name. The browser
 * suite adds the rows up and checks the total against them, which is the
 * assertion that keeps it that way.
 *
 * Nothing on this page charges anything or holds anything. "Continue" records
 * which fare was chosen and moves to the booking screen, where the price is
 * re-checked with the airline before a payment exists.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { flightOffers, flightSegments } from '@/db/schema';
import {
  Badge,
  Button,
  Card,
  CardHead,
  DefinitionList,
  Notice,
  Stack,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { RouteArc } from '@/components/travel/route-arc';
import {
  cabinLabel,
  clock,
  dayLabel,
  dayOffset,
  duration,
  rupees,
  stopsLabel,
} from '@/components/travel/format';
import { providerById } from '@/lib/travel/providers/registry';
import { platformFeeFor } from '@/lib/travel/pricing';
import { selectOfferAction } from '../../actions';
import { airlineNames, airportsByCode } from '../../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Fare detail',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function OfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ offer: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { offer: offerRef } = await params;
  const { error } = await searchParams;

  const offer = await db.query.flightOffers.findFirst({
    where: eq(flightOffers.publicRef, offerRef),
    with: { segments: { orderBy: [flightSegments.sliceIndex, flightSegments.position] } },
  });
  if (!offer) notFound();

  const search = await db.query.flightSearches.findFirst({
    where: (table, { eq: is }) => is(table.id, offer.searchId),
  });
  const passengerCount = Math.max(1, (search?.adults ?? 1) + (search?.children ?? 0));

  const expired = offer.expiresAt <= new Date();
  const sample = offer.source === 'SAMPLE';
  const [airlines, places] = await Promise.all([
    airlineNames(),
    airportsByCode(offer.segments.flatMap((segment) => [segment.originCode, segment.destinationCode])),
  ]);

  /**
   * The airline's own conditions.
   *
   * Fetched live rather than stored, because fare rules change and a cached copy
   * is a copy of something that may no longer be true. A provider that is slow
   * or absent means the page says so — never that the fare has no conditions.
   */
  const provider = providerById(offer.source);
  const [rules, baggage] = provider
    ? await Promise.all([
        provider.getFareRules(offer.providerOfferId).catch(() => null),
        provider.getBaggage(offer.providerOfferId).catch(() => []),
      ])
    : [null, []];

  const platformFeeMinor = platformFeeFor(offer.baseMinor);
  const allInMinor = offer.totalMinor + platformFeeMinor;
  const slices = groupSlices(offer.segments);
  const originPlace = places.get(offer.originCode);
  const destinationPlace = places.get(offer.destinationCode);

  return (
    <div className="wrap stack stack-5">
      <header className="page-head">
        <div className="page-head-text">
          <p className="eyebrow">
            <Link href="/travel">Travel</Link> · <Link href="/travel/flights">Flights</Link> · Fare
          </p>
          <h1>
            {originPlace?.city ?? offer.originCode} to {destinationPlace?.city ?? offer.destinationCode}
          </h1>
          <p>
            {airlines.get(offer.marketingCarrier) ?? offer.marketingCarrier} · {dayLabel(offer.departAt)} ·{' '}
            {duration(offer.durationMinutes)} · {stopsLabel(offer.stops)} · {cabinLabel(offer.cabin)}
          </p>
        </div>
      </header>

      {error ? <Notice tone="warn">{error}</Notice> : null}
      {expired ? (
        <Notice tone="warn">
          <strong>This fare has expired.</strong> A quote is good for minutes, not hours. Search again to
          see what the airline is charging now — nothing has been held or charged.
        </Notice>
      ) : null}
      {sample ? (
        <Notice tone="warn">
          <strong>Sample data from the development source.</strong> This is not an airline’s fare and
          cannot be flown. It exists so the search, pricing and booking flow can be exercised without a
          provider account; the production guard refuses to start with this source enabled.
        </Notice>
      ) : null}

      <div className="object-detail">
        <div className="stack stack-5">
          {slices.map((legs, sliceIndex) => (
            <Card key={sliceIndex}>
              <Stack gap={3}>
                <CardHead
                  title={slices.length > 1 ? (sliceIndex === 0 ? 'Outbound' : 'Return') : 'Your journey'}
                />
                <div>
                  {legs.map((leg, legIndex) => {
                    const previous = legIndex > 0 ? legs[legIndex - 1]! : null;
                    const layoverMinutes = previous
                      ? Math.round((leg.departAt.getTime() - previous.arriveAt.getTime()) / 60_000)
                      : 0;

                    return (
                      <div key={leg.id}>
                        {previous ? (
                          <p className="op-connection">
                            <Glyph name="clock" size={14} /> {duration(layoverMinutes)} in{' '}
                            {places.get(previous.destinationCode)?.city ?? previous.destinationCode}
                            {layoverMinutes < 60 ? ' — a tight connection' : ''}
                          </p>
                        ) : null}

                        <div className="op-leg">
                          <div className="op-leg-rail" aria-hidden="true">
                            <span className="op-leg-node" />
                            <span className="op-leg-track" />
                            <span className="op-leg-node" />
                          </div>
                          <div className="stack stack-2">
                            <p>
                              <span className="op-leg-time">{clock(leg.departAt)}</span>{' '}
                              <strong>{leg.originCode}</strong>{' '}
                              <span className="small muted">
                                {places.get(leg.originCode)?.name ?? ''}
                                {leg.originTerminal ? ` · Terminal ${leg.originTerminal}` : ''}
                              </span>
                            </p>
                            <p className="small muted">
                              {leg.marketingCarrier} {leg.flightNumber}
                              {leg.operatingCarrier && leg.operatingCarrier !== leg.marketingCarrier
                                ? ` · operated by ${airlines.get(leg.operatingCarrier) ?? leg.operatingCarrier}`
                                : ''}
                              {leg.aircraft ? ` · ${leg.aircraft}` : ''} · {duration(leg.durationMinutes)} ·{' '}
                              {cabinLabel(leg.cabin)}
                              {leg.bookingClass ? ` (${leg.bookingClass})` : ''}
                            </p>
                            <p>
                              <span className="op-leg-time">{clock(leg.arriveAt)}</span>{' '}
                              <strong>{leg.destinationCode}</strong>{' '}
                              <span className="small muted">
                                {places.get(leg.destinationCode)?.name ?? ''}
                                {leg.destinationTerminal ? ` · Terminal ${leg.destinationTerminal}` : ''}
                                {dayOffset(leg.departAt, leg.arriveAt) > 0
                                  ? ` · arrives ${dayOffset(leg.departAt, leg.arriveAt)} day later`
                                  : ''}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Stack>
            </Card>
          ))}

          <Card>
            <Stack gap={3}>
              <CardHead title="Fare conditions" />
              {rules === null ? (
                <p className="small muted">
                  {provider
                    ? 'The airline’s conditions could not be fetched just now. They are shown on the airline’s confirmation, and apply whether or not they load here.'
                    : 'The source this fare came from is not connected to this deployment, so its conditions cannot be fetched. They are not "none" — they are unknown here.'}
                </p>
              ) : (
                <Stack gap={3}>
                  <div className="row-wrap">
                    {rules.refundable === true ? <Badge tone="ok">Refundable</Badge> : null}
                    {rules.refundable === false ? <Badge tone="neutral">Not refundable</Badge> : null}
                    {rules.refundable === null ? <Badge tone="neutral">Refund terms not stated</Badge> : null}
                    {rules.changeable === true ? <Badge tone="ok">Changeable</Badge> : null}
                    {rules.changeable === false ? <Badge tone="neutral">Not changeable</Badge> : null}
                    {rules.cancellationFeeMinor !== null ? (
                      <Badge tone="warn">Cancellation fee {formatMoney(rules.cancellationFeeMinor)}</Badge>
                    ) : null}
                    {rules.changeFeeMinor !== null ? (
                      <Badge tone="warn">Change fee {formatMoney(rules.changeFeeMinor)}</Badge>
                    ) : null}
                  </div>
                  {rules.sections.length === 0 ? (
                    <p className="small muted">The airline published no further conditions for this fare.</p>
                  ) : (
                    rules.sections.map((section, index) => (
                      <details key={index} className="disclose">
                        <summary>{section.title}</summary>
                        {/* The carrier's own words. Rendered as text, never interpreted. */}
                        <p className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
                          {section.body}
                        </p>
                      </details>
                    ))
                  )}
                </Stack>
              )}
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <CardHead title="Baggage" />
              {baggage.length === 0 ? (
                <p className="small muted">
                  The airline did not state an allowance for this fare. Check it on the airline’s site
                  before you travel — an unstated allowance is not a generous one.
                </p>
              ) : (
                <DefinitionList
                  items={baggage.map((allowance) => [
                    allowance.passengerKind === 'ADULT'
                      ? 'Adult'
                      : allowance.passengerKind === 'CHILD'
                        ? 'Child'
                        : 'Infant',
                    <span key={allowance.passengerKind}>
                      {allowance.checkedBagKg !== null
                        ? `${allowance.checkedBagKg}kg checked`
                        : allowance.checkedBagCount !== null
                          ? `${allowance.checkedBagCount} checked bag${allowance.checkedBagCount === 1 ? '' : 's'}`
                          : 'Checked allowance not stated'}
                      {allowance.cabinBagKg !== null ? ` · ${allowance.cabinBagKg}kg cabin` : ''}
                      {allowance.extraBagMinor !== null
                        ? ` · extra bag ${formatMoney(allowance.extraBagMinor)}`
                        : ''}
                    </span>,
                  ])}
                />
              )}
            </Stack>
          </Card>
        </div>

        <div className="object-detail-aside">
          <Card>
            <Stack gap={3}>
              <CardHead title="What it costs" />
              <div>
                <div className="op-price-row">
                  <span>Fare{passengerCount > 1 ? `, ${passengerCount} passengers` : ''}</span>
                  <span className="num">{formatMoney(offer.baseMinor)}</span>
                </div>
                <div className="op-price-row">
                  <span>Taxes and carrier charges</span>
                  <span className="num">{formatMoney(offer.taxMinor)}</span>
                </div>
                {offer.providerFeeMinor > 0 ? (
                  <div className="op-price-row">
                    <span>Booking fee charged by the airline</span>
                    <span className="num">{formatMoney(offer.providerFeeMinor)}</span>
                  </div>
                ) : null}
                {platformFeeMinor > 0 ? (
                  <div className="op-price-row">
                    <span>{BRAND.name} service fee</span>
                    <span className="num">{formatMoney(platformFeeMinor)}</span>
                  </div>
                ) : null}
                <div className="op-price-row">
                  <span className="op-price-total">Total</span>
                  <span className="op-price-total num">{formatMoney(allInMinor)}</span>
                </div>
              </div>
              <p className="small muted">
                {passengerCount > 1 ? `${rupees(offer.perPassengerMinor)} per passenger. ` : ''}
                This is the whole amount — every mandatory charge is a line above, and there is no line
                for anything else to hide in. Bank offers and {BRAND.name} points come off it at the next
                step, and the price is re-checked with the airline before anything is charged.
              </p>
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <CardHead title="Continue" />
              <p className="small">
                Nothing is charged or held yet. The next screen asks the airline what this fare costs
                right now and takes your passenger details.
              </p>
              <form action={selectOfferAction}>
                <input type="hidden" name="offerRef" value={offer.publicRef} />
                <Button type="submit" variant="primary" size="lg" block disabled={expired}>
                  {expired ? 'This fare has expired' : `Continue with ${formatMoney(allInMinor)}`}
                </Button>
              </form>
              <p className="tiny muted">
                {expired
                  ? 'Search again to see the current fare.'
                  : `This quote lapses ${formatRelative(offer.expiresAt)}.`}{' '}
                {sample
                  ? 'Sample fare — the booking that follows exercises the real state machine against fixture data.'
                  : null}
              </p>
            </Stack>
          </Card>

          {originPlace && destinationPlace ? (
            <Card>
              <RouteArc from={originPlace} to={destinationPlace} />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type Segment = typeof flightSegments.$inferSelect;

/** Segments back into slices — outbound, return, and any further legs. */
function groupSlices(segments: Segment[]): Segment[][] {
  const bySlice = new Map<number, Segment[]>();
  for (const segment of segments) {
    const list = bySlice.get(segment.sliceIndex) ?? [];
    list.push(segment);
    bySlice.set(segment.sliceIndex, list);
  }
  return [...bySlice.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, legs]) => legs.sort((a, b) => a.position - b.position));
}
