/**
 * Travel — the hub.
 *
 * Four things live under /travel and this page is what makes them one product
 * rather than four links: searching for a flight, the intelligence that tells
 * you whether the fare you found is a good one, the trips you already have, and
 * the money side — what you have earned and what a bank will take off.
 *
 * The search is on an immersive stage at the top, because it is why almost
 * everybody is here and because a journey should start somewhere that looks
 * like the beginning of one. Under it, the thing a person most wants to see:
 * their next flight, drawn as the boarding pass it is rather than as a row in a
 * list.
 *
 * **What this page will not do.** If no flight source is connected it says so,
 * plainly, and does not show a search form that cannot produce anything. If the
 * *only* source is the development sample one — which is what a fresh clone
 * looks like — it says that too, at the top, before the form. Both are normal
 * states, and the honest response to either is a sentence naming what an
 * operator has to set, not a form that fails after the customer has filled it
 * in.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ButtonLink,
  Card,
  Empty,
  Money,
  Stat,
  StatRow,
  formatRelative,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { Guilloche } from '@/components/objects';
import { FeatureNote, StatusChip } from '@/components/system';
import { BoardingPass } from '@/components/travel/boarding-pass';
import { RouteArc } from '@/components/travel/route-arc';
import { SearchForm, defaultSearchValues } from '@/components/travel/search-form';
import { SourcePanel } from '@/components/travel/source-panel';
import { sourceSummary } from '@/components/travel/sources';
import { STATE_LABEL, dayLabel, indexTone } from '@/components/travel/format';
import { dataQuality, fareIndex, rankedRoutes } from '@/lib/travel/airindex';
import { cashbackTotals } from '@/lib/travel/cashback';
import { listBookings } from '@/lib/travel/booking';
import { currentActor } from '../_queries';
import { airlineNames, airportsByCode, listAirports, liveBankOfferCount } from './_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Travel',
  description:
    'Search flights across every connected source, see how a fare compares to what the route usually costs, and keep your trips in one place.',
};

export const dynamic = 'force-dynamic';

export default async function TravelPage() {
  const actor = await currentActor();
  const sources = sourceSummary();
  const now = new Date();

  const [airports, bookings, cashback, quality, routes, offerCount] = await Promise.all([
    listAirports(),
    listBookings(actor.userId, 20),
    cashbackTotals(actor.userId),
    dataQuality(),
    rankedRoutes(6),
    liveBankOfferCount(now),
  ]);

  const upcoming = bookings
    .filter(
      (booking) =>
        booking.departAt > now && booking.state !== 'CANCELLED' && booking.state !== 'REFUNDED',
    )
    .sort((a, b) => a.departAt.getTime() - b.departAt.getTime());
  const next = upcoming[0];

  // Only what the page will actually draw: the carrier names and the two
  // airports on the next flight, rather than every airport in the table.
  const [airlines, places] = await Promise.all([
    next ? airlineNames() : Promise.resolve(new Map<string, string>()),
    next ? airportsByCode([next.originCode, next.destinationCode]) : Promise.resolve(new Map()),
  ]);

  // The index for the busiest routes, so the hub says something about prices
  // rather than only linking to a page that does. A route without enough
  // observations says so; it does not get a faded number.
  const indices = await Promise.all(
    routes.slice(0, 4).map(async (route) => ({
      route,
      index: await fareIndex({ origin: route.originCode, destination: route.destinationCode }),
    })),
  );

  const doors = [
    {
      href: '/travel/trips',
      icon: 'ticket' as const,
      label: 'Your trips',
      note:
        upcoming.length > 0
          ? `${upcoming.length} coming up`
          : bookings.length > 0
            ? `${bookings.length} in your history`
            : 'Nothing booked yet',
    },
    {
      href: '/travel/airindex',
      icon: 'chart' as const,
      label: 'AirIndex',
      note:
        quality.routesWithEnoughData > 0
          ? `${quality.routesWithEnoughData} route${quality.routesWithEnoughData === 1 ? '' : 's'} with enough data`
          : 'No route has enough data yet',
    },
    {
      href: '/travel/rewards',
      icon: 'savings' as const,
      label: 'Your cashback',
      note:
        cashback.pendingMinor > 0
          ? `${cashback.pendingCount} booking${cashback.pendingCount === 1 ? '' : 's'} pending`
          : 'Nothing waiting',
    },
    {
      href: '/travel/discounts',
      icon: 'tag' as const,
      label: 'Bank offers',
      note: offerCount > 0 ? `${offerCount} running now` : 'None running',
    },
    {
      href: '/travel/stay',
      icon: 'plan' as const,
      label: 'Travel mode',
      note: 'Plan a stay from real rows',
    },
  ];

  return (
    <div className="wrap stack stack-6">
      {/* The stage. `.immersive` is night ink in both themes — it is a place,
          not a page — and the form sits on its own sheet inside it so the
          fields keep the contrast a text input needs. */}
      <section className="immersive travel-stage" aria-labelledby="search-heading">
        <Guilloche pattern="field" />
        <div className="travel-stage-grid">
          <div className="travel-stage-say">
            <p className="eyebrow">Travel</p>
            <h1 className="display h1" id="search-heading">
              Flights, and whether the price is a good one
            </h1>
            <p className="lede">
              {BRAND.name} asks every connected source at once and shows you what each one found — including
              the ones that did not answer. AirIndex then says how that fare compares to what the route has
              actually been costing.
            </p>
            <p className="travel-stage-note">
              <StatusChip featureKey="flights" />
              <span className="small">{sources.headline}</span>
            </p>
          </div>

          <div className="travel-stage-form">
            {sources.state === 'NONE' ? (
              <div className="stack stack-4">
                <h2 className="h3">Nothing to search yet</h2>
                <p className="small">{sources.detail}</p>
                <SourcePanel summary={sources} outcomes={[]} />
                <p className="tiny muted">
                  See <code>.env.example</code> and <code>docs/integrations.md</code> for what each source
                  needs.
                </p>
              </div>
            ) : (
              <div className="stack stack-4">
                <h2 className="h3">Where to?</h2>
                <SearchForm
                  airports={airports}
                  values={defaultSearchValues()}
                  footnote={
                    sources.state === 'SAMPLE_ONLY'
                      ? 'Results come from the development sample source. They are labelled, and none of them can be flown.'
                      : `Asked of ${sources.live.map((provider) => provider.label).join(' and ')} at once.`
                  }
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="next-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="next-heading">Next flight</h2>
          <Link className="small" href="/travel/trips">
            All trips
          </Link>
        </div>

        {next ? (
          <div className="object-detail">
            <BoardingPass
              booking={next}
              airline={airlines.get(next.marketingCarrier)}
              originCity={places.get(next.originCode)?.city}
              destinationCity={places.get(next.destinationCode)?.city}
              href={`/travel/trips/${next.ref}`}
              transitionName={`flight-${next.ref}`}
            />
            <div className="object-detail-aside">
              <Card className="stack stack-3">
                <p className="eyebrow plain">{formatRelative(next.departAt)}</p>
                <p className="small">
                  {STATE_LABEL[next.state] ?? next.state} · departs {dayLabel(next.departAt)}.{' '}
                  {next.pnr
                    ? 'Quote the airline reference on the pass at the airline’s own check-in.'
                    : 'No airline reference yet — one is issued when the airline confirms the booking.'}
                </p>
                {places.get(next.originCode) && places.get(next.destinationCode) ? (
                  <RouteArc from={places.get(next.originCode)!} to={places.get(next.destinationCode)!} />
                ) : null}
                <ButtonLink href={`/travel/trips/${next.ref}`} variant="ghost">
                  Open this trip
                </ButtonLink>
              </Card>

              {upcoming.length > 1 ? (
                <Card className="stack stack-3">
                  <h3 className="eyebrow plain">After that</h3>
                  <ul className="ledger">
                    {upcoming.slice(1, 4).map((booking) => (
                      <li key={booking.ref}>
                        <span className="ledger-main">
                          <Link className="ledger-title" href={`/travel/trips/${booking.ref}`}>
                            {booking.originCode} → {booking.destinationCode}
                          </Link>
                          <span className="ledger-meta">
                            {dayLabel(booking.departAt)} · {STATE_LABEL[booking.state] ?? booking.state}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          </div>
        ) : (
          <Card>
            <Empty
              title="Nothing booked yet"
              body={
                sources.state === 'NONE'
                  ? 'A flight booked here would appear as a boarding pass. No source is connected on this deployment, so there is nothing to book.'
                  : 'A flight you book appears here as a boarding pass, with the airline’s reference and your ticket numbers as soon as they exist.'
              }
              action={
                sources.state === 'NONE' ? undefined : (
                  <ButtonLink href="/travel/flights" variant="primary">
                    Search flights
                  </ButtonLink>
                )
              }
            />
          </Card>
        )}
      </section>

      <section aria-labelledby="doors-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="doors-heading">The rest of travel</h2>
        </div>
        <div className="travel-doors">
          {doors.map((door) => (
            <Link key={door.href} href={door.href} className="travel-door">
              <span className="travel-door-mark" aria-hidden="true">
                <Glyph name={door.icon} size={18} />
              </span>
              <span className="travel-door-label">{door.label}</span>
              <span className="travel-door-note">{door.note}</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="index-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="index-heading">What routes have been costing</h2>
          <Link className="small" href="/travel/airindex">
            Open AirIndex
          </Link>
        </div>

        <p className="small muted" style={{ maxWidth: '68ch' }}>
          An index of 100 means fares on that route are about what they have been over the three months
          before. Higher is dearer than usual. Every figure is a median over prices this system recorded
          while people searched, with the sample size beside it — and a route with fewer than{' '}
          {quality.minimumSample} observations publishes nothing at all.
        </p>

        {indices.length === 0 ? (
          <Card>
            <Empty
              title="No prices observed yet"
              body="AirIndex is computed from the searches this deployment runs. Search for a flight and the first observations are recorded."
              action={<ButtonLink href="/travel/flights">Search flights</ButtonLink>}
            />
          </Card>
        ) : (
          <>
            <Card>
              <ul className="ledger">
                {indices.map(({ route, index }) => (
                  <li key={`${route.originCode}-${route.destinationCode}`}>
                    <span className="ledger-main">
                      <Link
                        className="ledger-title"
                        href={`/travel/airindex/routes?from=${route.originCode}&to=${route.destinationCode}`}
                      >
                        {route.originCode} → {route.destinationCode}
                      </Link>
                      <span className="ledger-meta">
                        {route.originCity ?? route.originCode} to{' '}
                        {route.destinationCity ?? route.destinationCode} · median{' '}
                        <Money minor={route.medianMinor} /> over{' '}
                        {route.sampleSize.toLocaleString('en-IN')} observation
                        {route.sampleSize === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="ledger-figure">
                      {index.index === null ? (
                        <span className="badge badge-neutral">Not enough data</span>
                      ) : (
                        <span className={`badge badge-${indexTone(index.index)}`}>
                          {index.index} · {index.index < 100 ? 'below usual' : index.index > 100 ? 'above usual' : 'usual'}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <StatRow>
              <Stat
                label="Prices observed"
                value={quality.totalObservations.toLocaleString('en-IN')}
                hint={`${quality.observationsLast7Days.toLocaleString('en-IN')} in the last seven days`}
                tone="accent"
              />
              <Stat
                label="Routes covered"
                value={quality.routesCovered}
                hint={`${quality.routesWithEnoughData} with enough data to publish`}
              />
              <Stat label="Airlines seen" value={quality.carriersSeen} tone="neutral" />
            </StatRow>
          </>
        )}
      </section>

      <section aria-labelledby="money-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="money-heading">What travel has earned you</h2>
          <Link className="small" href="/travel/rewards">
            Your cashback
          </Link>
        </div>

        <StatRow>
          <Stat
            label="Cashback pending"
            value={<Money minor={cashback.pendingMinor} />}
            tone="warn"
            hint={
              cashback.pendingCount === 0
                ? 'Nothing waiting'
                : `${cashback.pendingCount} booking${cashback.pendingCount === 1 ? '' : 's'}, credited after the airline’s cancellation window closes`
            }
          />
          <Stat
            label="Cashback credited"
            value={<Money minor={cashback.creditedMinor} />}
            tone="ok"
            hint="Already in your points balance"
          />
          <Stat
            label="Bank offers running"
            value={offerCount}
            tone="neutral"
            hint={<Link href="/travel/discounts">See the terms</Link>}
          />
        </StatRow>

        <Card className="stack stack-3">
          <p className="small">
            A bank offer comes off the fare at checkout, applied by the payment provider. Cashback is
            credited as {BRAND.name} points once the booking is certain. They are shown separately because
            they are paid by different people at different times, and pending cashback is not money you
            have yet.
          </p>
          <FeatureNote featureKey="flight-cashback" />
          <FeatureNote featureKey="bank-offers" />
        </Card>
      </section>

      {/* Last on the screen, and the first thing an operator looks for. */}
      <p className="tiny muted">
        {sources.detail}{' '}
        {sources.waiting.length > 0
          ? `Waiting on credentials: ${sources.waiting.map((provider) => `${provider.label} (${provider.requires.join(', ')})`).join('; ')}.`
          : null}
      </p>
    </div>
  );
}
