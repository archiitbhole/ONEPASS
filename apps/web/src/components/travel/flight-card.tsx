/**
 * One fare, as a card.
 *
 * The layout is the argument. A flight is chosen on four things — when it
 * leaves, when it lands, how long it takes and what it costs — so those four
 * are the largest text on the card and everything else is subordinate to them.
 * The journey reads left to right as a line, because that is the shape of the
 * thing being described.
 *
 * **The price is the all-in price.** `offer.totalMinor` is what the provider
 * quoted; it does not include this deployment's own service fee, which is
 * computed from the fare in `pricing.ts`. The fare detail page has always added
 * it and the card did not, so a deployment that charged a fee would have shown
 * one figure in the list and a larger one on the next screen. The caller passes
 * the fee it computed and the card leads with the sum — and names the fee
 * underneath, because a fee folded into a total is the same dishonesty as a
 * fee folded into "taxes".
 *
 * **The fare index sits on the card, not on a separate page.** Knowing that
 * this fare is 12% above what the route usually costs is only useful at the
 * moment of choosing. Where there is not enough data the badge is simply absent
 * — no "unknown" chip, no grey placeholder, because an absent badge says
 * nothing and a grey one says something wrong.
 *
 * **The source is always named.** A fare from the development source gets a
 * band across the top of the object rather than a chip at the bottom: that
 * label is the difference between a demonstration and a thing somebody is about
 * to spend money on, and it should not be something a person can scroll past.
 */
import Link from 'next/link';
import { Badge, formatMoney } from '@/components/ui';
import { Glyph } from '@/components/icons';
import type { StoredOffer } from '@/lib/travel/search';
import { BRAND } from '@/lib/brand';
import { cabinLabel, clock, dayOffset, duration, rupees, stopsLabel } from './format';

export interface FlightCardProps {
  offer: StoredOffer;
  /** Airline names by IATA code, so the card does not query for them itself. */
  airlineNames: Map<string, string>;
  /** Where "Select" goes. Null renders the card without an action. */
  href: string | null;
  /** This deployment's own fee on this fare, in minor units. Usually zero. */
  platformFeeMinor?: number;
  /** How many fare-paying passengers the search was for. */
  passengers?: number;
  /**
   * How this fare compares to the route's median, in percent. Null when there
   * is not enough data — in which case nothing is shown rather than a
   * placeholder.
   */
  versusMedian?: number | null;
  /** True for the lowest fare in the list. */
  cheapest?: boolean;
  /** True for the shortest journey in the list. */
  quickest?: boolean;
}

export function FlightCard({
  offer,
  airlineNames,
  href,
  platformFeeMinor = 0,
  passengers = 1,
  versusMedian = null,
  cheapest = false,
  quickest = false,
}: FlightCardProps) {
  const legs = offer.segments.filter((segment) => segment.sliceIndex === 0);
  const first = legs[0];
  const last = legs[legs.length - 1];
  const plusDays = first && last ? dayOffset(first.departAt, last.arriveAt) : 0;
  const airline = airlineNames.get(offer.marketingCarrier) ?? offer.marketingCarrier;
  const sample = offer.source === 'SAMPLE';
  const allInMinor = offer.totalMinor + platformFeeMinor;

  return (
    <article
      className="op-flight"
      data-sample={sample ? 'true' : undefined}
      aria-label={`${airline} ${offer.originCode} to ${offer.destinationCode}, ${rupees(allInMinor)}`}
    >
      {sample ? (
        <p className="op-flight-sample">
          <Glyph name="alert" size={14} />
          Sample fare — cannot be flown
        </p>
      ) : null}

      <div className="op-flight-main">
        <div className="op-flight-carrier">
          <span className="op-flight-code" aria-hidden="true">
            {offer.marketingCarrier}
          </span>
          <div style={{ minWidth: 0 }}>
            <p className="op-flight-airline">{airline}</p>
            <p className="tiny muted">
              {legs.map((leg) => `${leg.marketingCarrier} ${leg.flightNumber}`).join(' · ')}
            </p>
          </div>
        </div>

        <div className="op-flight-times">
          <div className="op-flight-end">
            {/* Only the clock time in this element: the arrival's "+1" lives
                outside its sibling for the same reason — a time that reads
                "08:15+1" cannot be parsed by anybody, human or test. */}
            <p className="op-flight-time">{first ? clock(first.departAt) : '—'}</p>
            <p className="op-flight-iata">{offer.originCode}</p>
          </div>

          <div className="op-flight-mid">
            <p className="tiny muted">{duration(offer.durationMinutes)}</p>
            {/* A line with a dot per stop. Decorative: the stops are stated in
                words below it, so a screen reader is not read a row of dashes. */}
            <div className="op-flight-line" aria-hidden="true">
              <span className="op-flight-dot" />
              {legs.slice(0, -1).map((leg) => (
                <span key={leg.position} className="op-flight-stop" title={leg.destinationCode} />
              ))}
              <span className="op-flight-dot" />
            </div>
            <p className="tiny muted">
              {stopsLabel(offer.stops)}
              {offer.stops > 0 ? ` · ${legs.slice(0, -1).map((leg) => leg.destinationCode).join(', ')}` : ''}
            </p>
          </div>

          <div className="op-flight-end">
            <p>
              <span className="op-flight-time">{last ? clock(last.arriveAt) : '—'}</span>
              {plusDays > 0 ? (
                <sup className="op-flight-plus" title={`arrives ${plusDays} day later`}>
                  +{plusDays}
                </sup>
              ) : null}
            </p>
            <p className="op-flight-iata">{offer.destinationCode}</p>
          </div>
        </div>

        <div className="op-flight-price">
          <p className="op-flight-fare">{rupees(allInMinor)}</p>
          {platformFeeMinor > 0 ? (
            <p className="tiny muted">
              includes {formatMoney(platformFeeMinor)} {BRAND.name} fee
            </p>
          ) : passengers > 1 ? (
            <p className="tiny muted">{rupees(offer.perPassengerMinor)} each · all taxes in</p>
          ) : (
            <p className="tiny muted">all taxes and charges in</p>
          )}
          {href ? (
            <Link href={href} className="btn btn-primary btn-sm">
              Select
            </Link>
          ) : null}
        </div>
      </div>

      <div className="op-flight-tags">
        {cheapest ? <Badge tone="ok">Cheapest</Badge> : null}
        {quickest ? <Badge tone="info">Quickest</Badge> : null}
        <Badge tone="neutral">{cabinLabel(offer.cabin)}</Badge>
        {offer.fareBrand ? <Badge tone="neutral">{offer.fareBrand}</Badge> : null}

        {/* Only what the provider actually stated. A fare that says nothing about
            refunds gets no chip, rather than a "non-refundable" we invented. */}
        {offer.refundable === true ? <Badge tone="ok">Refundable</Badge> : null}
        {offer.refundable === false ? <Badge tone="neutral">Non-refundable</Badge> : null}
        {offer.checkedBagKg !== null ? <Badge tone="neutral">{offer.checkedBagKg}kg checked</Badge> : null}
        {offer.seatsRemaining !== null && offer.seatsRemaining <= 4 ? (
          <Badge tone="warn">{offer.seatsRemaining} left at this fare</Badge>
        ) : null}

        {versusMedian !== null && Math.abs(versusMedian) >= 5 ? (
          <Badge tone={versusMedian < 0 ? 'ok' : 'warn'}>
            {Math.abs(versusMedian)}% {versusMedian < 0 ? 'below' : 'above'} the usual fare
          </Badge>
        ) : null}

        {sample ? null : <Badge tone="neutral">via {offer.source === 'AMADEUS' ? 'Amadeus' : 'Duffel'}</Badge>}
      </div>
    </article>
  );
}
