/**
 * Flight results.
 *
 * The search runs here, on the server, from the query string. That makes the
 * result a URL — shareable, bookmarkable, and reopenable with the back button —
 * and it means the page works before any JavaScript has loaded.
 *
 * **Every source is accounted for.** Above the results is a line per source
 * saying what it returned, how long it took, or why it did not answer — and a
 * source that is not connected at all gets a line too. A comparison product
 * that quietly drops a failing supplier is a comparison product that cannot be
 * trusted: "nothing cheap on this route" and "one of our two sources was down"
 * look identical from the outside, and only one of them is a reason to search
 * again in a minute.
 *
 * **The filters are links, not state.** Sorting, hiding connections, picking an
 * airline or a part of the day re-renders from the same persisted search — no
 * second provider call, no client-side store, and each filtered view has its
 * own URL. Every option carries the number of fares it would leave, computed
 * from the rows already in hand.
 *
 * **The figure on a card is the whole figure.** `offer.totalMinor` is the
 * provider's quote; this deployment's own service fee is computed from the fare
 * and added before the card is drawn, because a price that grows on the next
 * screen is the oldest trick in travel.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { ButtonLink, Card, Empty, Money, Notice, Stat, StatRow } from '@/components/ui';
import { FeatureNote } from '@/components/system';
import { FlightCard } from '@/components/travel/flight-card';
import { FilterRail, type FilterGroup } from '@/components/travel/result-filters';
import { SearchForm } from '@/components/travel/search-form';
import { SourcePanel } from '@/components/travel/source-panel';
import { sourceSummary } from '@/components/travel/sources';
import {
  BAND_LABEL,
  cabinLabel,
  dayLabel,
  departureBand,
  indexTone,
  rupees,
  type DepartureBand,
} from '@/components/travel/format';
import { MIN_SAMPLE, fareIndex, routeFigures } from '@/lib/travel/airindex';
import { loadSearch, searchFlights, type SearchResult, type StoredOffer } from '@/lib/travel/search';
import { platformFeeFor } from '@/lib/travel/pricing';
import { consume } from '@/lib/ratelimit';
import { AppError } from '@/lib/errors';
import type { Cabin, TripKind } from '@/lib/travel/providers/types';
import { currentActor } from '../../../_queries';
import { airlineNames, airportsByCode, listAirports } from '../../_queries';

export const metadata: Metadata = {
  title: 'Flight results',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Sort = 'price' | 'duration' | 'departure';

interface Query {
  from?: string;
  to?: string;
  depart?: string;
  return?: string;
  trip?: string;
  cabin?: string;
  adults?: string;
  children?: string;
  infants?: string;
  direct?: string;
  flex?: string;
  sort?: string;
  stops?: string;
  /** One marketing carrier's IATA code. A view over rows already fetched. */
  carrier?: string;
  /** Part of the day the outbound leaves in, at the origin airport. */
  when?: string;
  /** A search that has already been run. Re-renders it without asking a provider. */
  s?: string;
}

interface Filters {
  sort: Sort;
  maxStops: number | null;
  carrier: string | null;
  when: DepartureBand | null;
}

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number((value ?? '').trim());
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readCabin(value: string | undefined): Cabin {
  const allowed: Cabin[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
  return allowed.find((cabin) => cabin === value) ?? 'ECONOMY';
}

function readTripKind(value: string | undefined): TripKind {
  return value === 'RETURN' ? 'RETURN' : value === 'MULTI_CITY' ? 'MULTI_CITY' : 'ONE_WAY';
}

/** The current query, with one parameter replaced. Filters are links, so this builds them. */
function withParam(query: Query, key: string, value: string | null): string {
  const params = new URLSearchParams();
  for (const [name, existing] of Object.entries(query)) {
    if (existing !== undefined && existing !== '') params.set(name, String(existing));
  }
  if (value === null) params.delete(key);
  else params.set(key, value);
  return `/travel/flights/results?${params.toString()}`;
}

export default async function ResultsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const actor = await currentActor();
  const sources = sourceSummary();

  const origin = (query.from ?? '').trim().toUpperCase();
  const destination = (query.to ?? '').trim().toUpperCase();
  const departOn = (query.depart ?? '').trim();

  // Not a search at all — somebody typed the URL. The search page is the answer,
  // not an error.
  if (!origin || !destination || !departOn) notFound();

  const tripKind = readTripKind(query.trip);
  const returnOn = (query.return ?? '').trim();
  const cabin = readCabin(query.cabin);
  const adults = readInt(query.adults, 1, 1, 9);
  const children = readInt(query.children, 0, 0, 8);
  const infants = readInt(query.infants, 0, 0, 4);
  const flexDays = readInt(query.flex, 0, 0, 3);
  const directOnly = query.direct === '1';
  const filters: Filters = {
    sort: query.sort === 'duration' ? 'duration' : query.sort === 'departure' ? 'departure' : 'price',
    maxStops: query.stops === '0' ? 0 : query.stops === '1' ? 1 : null,
    carrier: /^[A-Z0-9]{2}$/.test((query.carrier ?? '').toUpperCase())
      ? (query.carrier ?? '').toUpperCase()
      : null,
    when: query.when === 'am' || query.when === 'pm' || query.when === 'eve' ? query.when : null,
  };

  const slices =
    tripKind === 'RETURN' && returnOn
      ? [
          { origin, destination, departOn },
          { origin: destination, destination: origin, departOn: returnOn },
        ]
      : [{ origin, destination, departOn }];

  const [airports, airlines] = await Promise.all([listAirports(), airlineNames()]);

  /**
   * The rate limit, before any provider is asked.
   *
   * A search costs a supplier call, and a supplier bills for it. Keyed on the
   * signed-in user — this route is behind the consumer shell, so there always is
   * one — with the source address as a secondary key for the same reason every
   * other limit here has one.
   */
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  // Only a request that will actually ask a provider spends allowance. Re-reading
  // a persisted search costs a database query and nothing else, and charging for
  // it would rate-limit somebody for pressing the back button.
  const willSearch = !query.s;
  const allowance = willSearch
    ? await consume('travel:search', actor.userId)
    : { ok: true, resetSeconds: 0, remaining: 0, limit: 0 };
  const ipAllowance = willSearch
    ? await consume('travel:search', `ip:${ip}`)
    : { ok: true, resetSeconds: 0, remaining: 0, limit: 0 };

  let result: SearchResult | null = null;
  let error: string | null = null;

  /**
   * A search that has already been run.
   *
   * `?s=<ref>` re-renders the persisted search with no provider call at all.
   * That is what makes a results link shareable and the back button free: a page
   * that re-queried three suppliers every time somebody reopened it would cost
   * money on a bookmark, and would show a different set of fares each time to
   * somebody who thought they were looking at the same page.
   *
   * It expires with the search, and an expired reference falls through to a
   * fresh search rather than to an error — reopening an old link should work,
   * just not for free.
   */
  const persisted = query.s ? await loadSearch(query.s) : null;

  if (persisted) {
    result = {
      searchRef: persisted.searchRef,
      searchId: persisted.searchId,
      offers: persisted.offers,
      providers: [],
      elapsedMs: 0,
      expiresAt: persisted.expiresAt,
      cached: true,
      unavailable: null,
    };
  } else if (!allowance.ok || !ipAllowance.ok) {
    error = `That is a lot of searches in a short time. Try again in ${Math.max(allowance.resetSeconds, ipAllowance.resetSeconds)} seconds.`;
  } else if (sources.state === 'NONE') {
    error = sources.detail;
  } else {
    try {
      result = await searchFlights({
        slices,
        tripKind,
        cabin,
        adults,
        children,
        infants,
        directOnly,
        flexDays,
        maxPriceMinor: null,
        currency: 'INR',
        userId: actor.userId,
      });
    } catch (err) {
      // A validation failure is the customer's to fix and says how; anything
      // else is ours, and is not described to them in the internals' words.
      error = err instanceof AppError ? err.message : 'That search could not be run. Try again in a moment.';
    }
  }

  const all = result?.offers ?? [];
  const offers = filterAndSort(all, filters);
  const places = await airportsByCode([origin, destination]);
  const originPlace = places.get(origin);
  const destinationPlace = places.get(destination);

  // The route's own figures, so a fare can be compared to something. Only asked
  // for when there are results to compare.
  const [index, figures] =
    all.length > 0
      ? await Promise.all([
          fareIndex({ origin, destination, cabin }),
          routeFigures({ origin, destination, cabin }),
        ])
      : [null, null];

  // The all-in price per offer, computed once. A card must never lead with a
  // figure smaller than the one the next screen asks for.
  const allIn = new Map(all.map((offer) => [offer.ref, offer.totalMinor + platformFeeFor(offer.baseMinor)]));
  const cheapest = offers.length > 0 ? Math.min(...offers.map((offer) => allIn.get(offer.ref) ?? offer.totalMinor)) : null;
  const quickest = offers.length > 0 ? Math.min(...offers.map((offer) => offer.durationMinutes)) : null;
  const passengers = adults + children;

  const carriers = [...new Set(all.map((offer) => offer.marketingCarrier))].sort();
  const count = (over: Partial<Filters>) => filterAndSort(all, { ...filters, ...over }).length;

  const groups: FilterGroup[] = [
    {
      legend: 'Order',
      options: (
        [
          ['price', 'Cheapest'],
          ['duration', 'Quickest'],
          ['departure', 'Earliest'],
        ] as const
      ).map(([value, label]) => ({
        label,
        href: withParam(query, 'sort', value),
        current: filters.sort === value,
      })),
    },
    {
      legend: 'Stops',
      options: [
        {
          label: 'Any',
          href: withParam(query, 'stops', null),
          current: filters.maxStops === null,
          count: count({ maxStops: null }),
        },
        {
          label: 'Nonstop only',
          href: withParam(query, 'stops', '0'),
          current: filters.maxStops === 0,
          count: count({ maxStops: 0 }),
        },
      ],
    },
    {
      legend: 'Leaves',
      options: [
        {
          label: 'Any time',
          href: withParam(query, 'when', null),
          current: filters.when === null,
          count: count({ when: null }),
        },
        ...(['am', 'pm', 'eve'] as const).map((band) => ({
          label: BAND_LABEL[band],
          href: withParam(query, 'when', band),
          current: filters.when === band,
          count: count({ when: band }),
        })),
      ],
    },
  ];

  if (carriers.length > 1) {
    groups.push({
      legend: 'Airline',
      options: [
        {
          label: 'All',
          href: withParam(query, 'carrier', null),
          current: filters.carrier === null,
          count: count({ carrier: null }),
        },
        ...carriers.map((code) => ({
          label: airlines.get(code) ?? code,
          href: withParam(query, 'carrier', code),
          current: filters.carrier === code,
          count: count({ carrier: code }),
        })),
      ],
    });
  }

  const filtered = all.length !== offers.length;

  return (
    <div className="wrap stack stack-5">
      <header className="page-head">
        <div className="page-head-text">
          <p className="eyebrow">
            <Link href="/travel">Travel</Link> · <Link href="/travel/flights">Flights</Link> · Results
          </p>
          <h1>
            {originPlace?.city ?? origin} to {destinationPlace?.city ?? destination}
          </h1>
          <p>
            {dayLabel(new Date(`${departOn}T00:00:00+05:30`))}
            {tripKind === 'RETURN' && returnOn
              ? ` — ${dayLabel(new Date(`${returnOn}T00:00:00+05:30`))}`
              : ''}
            {' · '}
            {passengers} passenger{passengers === 1 ? '' : 's'}
            {infants > 0 ? ` and ${infants} infant${infants === 1 ? '' : 's'}` : ''}
            {' · '}
            {cabinLabel(cabin)}
            {directOnly ? ' · nonstop searched' : ''}
          </p>
        </div>
      </header>

      {error ? <Notice tone="warn">{error}</Notice> : null}
      {result?.unavailable ? <Notice tone="warn">{result.unavailable}</Notice> : null}
      {sources.state === 'SAMPLE_ONLY' && !error ? (
        <Notice tone="warn">
          <strong>These are sample fares.</strong> {sources.detail}
        </Notice>
      ) : null}

      <section aria-labelledby="sources-heading" className="stack stack-3">
        <div className="section-head">
          <h2 id="sources-heading" className="h3">
            Where these came from
          </h2>
          {result && result.providers.length > 0 ? (
            <span className="small muted">
              {all.length} fare{all.length === 1 ? '' : 's'} in {(result.elapsedMs / 1000).toFixed(1)}s
            </span>
          ) : null}
        </div>
        <SourcePanel
          summary={sources}
          outcomes={result?.providers ?? []}
          replayed={result !== null && result.providers.length === 0}
        />
        {result && result.providers.length === 0 ? (
          <p className="small muted">
            These are the results of a search you already ran, re-shown without asking the airlines again.{' '}
            <Link href={withParam({ ...query, s: undefined }, 'sort', filters.sort)}>
              Search again for current fares
            </Link>
            .
          </p>
        ) : null}
      </section>

      {index && figures && figures.medianMinor !== null ? (
        <section aria-labelledby="index-heading" className="stack stack-3">
          <div className="section-head">
            <h2 id="index-heading" className="h3">
              How this route is priced right now
            </h2>
            <Link className="small" href={`/travel/airindex/routes?from=${origin}&to=${destination}`}>
              The full picture
            </Link>
          </div>
          <StatRow>
            {/* The index needs history on both sides of the comparison. Where
                there is a median but not yet an index, the median is still
                worth showing — and saying so is better than a card that
                vanishes while the fares below it carry "below the usual fare"
                badges computed from the very same median. */}
            <Stat
              label="Fare index"
              value={index.index ?? '—'}
              hint={index.verdict}
              tone={indexTone(index.index)}
            />
            <Stat
              label="Usual fare"
              value={<Money minor={figures.medianMinor} />}
              hint={`Median of ${index.referenceSample.toLocaleString('en-IN')} prices over the 90 days before this week`}
            />
            <Stat
              label="Typical range"
              value={
                figures.p25Minor && figures.p75Minor
                  ? `${rupees(figures.p25Minor)} – ${rupees(figures.p75Minor)}`
                  : '—'
              }
              hint="Middle half of what has been observed"
            />
          </StatRow>
          {figures.sampleSize < MIN_SAMPLE * 3 ? (
            <p className="tiny muted">
              This route rests on {figures.sampleSize.toLocaleString('en-IN')} observations — thin enough
              that one unusual fare moves it. Read it as a direction rather than a figure.
            </p>
          ) : null}
        </section>
      ) : null}

      {all.length > 0 ? (
        <section aria-labelledby="fares-heading" className="stack stack-4">
          <div className="section-head">
            <h2 id="fares-heading">
              {offers.length} fare{offers.length === 1 ? '' : 's'}
              {filtered ? <span className="muted"> of {all.length}</span> : null}
            </h2>
            {filtered ? (
              <Link className="small" href={withParam({ ...query, carrier: undefined, when: undefined, stops: undefined }, 'sort', filters.sort)}>
                Clear filters
              </Link>
            ) : null}
          </div>

          <FilterRail groups={groups} label="Filter and order these fares" />

          {offers.length === 0 ? (
            <Card>
              <Empty
                title="No fare matches these filters"
                body={`All ${all.length} fares are still here — the filters above are hiding them. Clear one to see them again.`}
                action={
                  <ButtonLink
                    href={withParam(
                      { ...query, carrier: undefined, when: undefined, stops: undefined },
                      'sort',
                      filters.sort,
                    )}
                  >
                    Clear filters
                  </ButtonLink>
                }
              />
            </Card>
          ) : (
            <ul className="stack stack-3">
              {offers.map((offer) => (
                <li key={offer.ref}>
                  <FlightCard
                    offer={offer}
                    airlineNames={airlines}
                    href={`/travel/flights/${offer.ref}`}
                    platformFeeMinor={platformFeeFor(offer.baseMinor)}
                    passengers={passengers}
                    versusMedian={
                      figures?.medianMinor
                        ? Math.round(
                            ((offer.perPassengerMinor - figures.medianMinor) / figures.medianMinor) * 100,
                          )
                        : null
                    }
                    cheapest={(allIn.get(offer.ref) ?? offer.totalMinor) === cheapest}
                    quickest={offer.durationMinutes === quickest}
                  />
                </li>
              ))}
            </ul>
          )}

          {result ? (
            <p className="tiny muted">
              These fares expire at{' '}
              {result.expiresAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} and are
              re-checked with the airline before you pay — if the price has moved you will be shown both
              figures and asked again.{' '}
              {result.searchRef ? (
                <Link href={withParam({ ...query, s: result.searchRef }, 'sort', filters.sort)}>
                  Link to these exact results
                </Link>
              ) : null}
            </p>
          ) : null}
        </section>
      ) : error ? null : (
        <Card>
          <Empty
            title="Nothing found on this route"
            body={
              result && result.providers.some((provider) => !provider.ok)
                ? 'A source did not answer. What is above is everything that did — nothing has been substituted for the missing one.'
                : 'No source had a fare for these dates. Try a different date, or allow connections.'
            }
            action={<ButtonLink href="/travel/flights">Change the search</ButtonLink>}
          />
        </Card>
      )}

      <details className="disclose">
        <summary>Change this search</summary>
        <div style={{ marginBlockStart: 'var(--s-3)' }}>
          <SearchForm
            airports={airports}
            submitLabel="Search again"
            values={{
              origin,
              destination,
              departOn,
              returnOn: returnOn || departOn,
              tripKind,
              cabin,
              adults,
              children,
              infants,
              directOnly,
              flexDays,
            }}
          />
        </div>
      </details>

      <FeatureNote featureKey="flights" />
    </div>
  );
}

/**
 * Filter and sort the persisted result.
 *
 * Every one of these is a view over rows already fetched — changing the sort
 * costs nothing and asks no provider anything. The secondary sort is always
 * price, so two flights of identical duration appear in a stable order rather
 * than shuffling between renders.
 */
function filterAndSort(offers: StoredOffer[], filters: Filters): StoredOffer[] {
  const filtered = offers.filter((offer) => {
    if (filters.maxStops !== null && offer.stops > filters.maxStops) return false;
    if (filters.carrier !== null && offer.marketingCarrier !== filters.carrier) return false;
    if (filters.when !== null && departureBand(offer.departAt) !== filters.when) return false;
    return true;
  });
  const sorted = [...filtered];

  switch (filters.sort) {
    case 'duration':
      sorted.sort((a, b) => a.durationMinutes - b.durationMinutes || a.totalMinor - b.totalMinor);
      break;
    case 'departure':
      sorted.sort((a, b) => a.departAt.getTime() - b.departAt.getTime() || a.totalMinor - b.totalMinor);
      break;
    default:
      sorted.sort((a, b) => a.totalMinor - b.totalMinor || a.durationMinutes - b.durationMinutes);
  }

  return sorted;
}
