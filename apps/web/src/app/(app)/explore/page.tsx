/**
 * Explore — the venues on ONEPASS, and what is open at them right now.
 *
 * Two decisions shape the whole screen.
 *
 * **It is a shelf of places, not a table of rows.** A venue is somewhere you
 * might go tonight, so it is drawn with a poster: line-work seeded from its own
 * public reference, its kind as a glyph, its city printed along the bottom. We
 * own no photographs of these places and stock photography would imply a room
 * looks like something it may not, so the poster is the honest image — see
 * `<Poster>` in components/objects.
 *
 * **It says how much there is.** "Discover places near you" is the sentence
 * every listing app writes, and on a platform with a few dozen partner venues
 * it is a lie of scale. The header prints the real totals and states plainly
 * that this is the whole list rather than a page of a larger one. Nothing here
 * implies national coverage, and nothing is shown that is not a row.
 *
 * All the state is in the URL: the search box is a GET form, the city and
 * category controls are links, and the page is rendered on the server from
 * `searchParams`. A filtered view can be shared, bookmarked, reloaded and read
 * by a crawler, and the screen ships no JavaScript to manage any of it — the
 * only client code is the countdown on a live offer.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Empty,
  PageHead,
  formatMoney,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { Poster } from '@/components/objects';
import { StatusChip } from '@/components/system';
import { Countdown } from '@/components/consumer/countdown';
import { DealCard } from '@/components/consumer/deal-card';
import { labelKind } from '@/components/consumer/format';
import { listLiveDeals, type LiveDeal } from '@/lib/commerce/offers';
import {
  currentActor,
  discoverVenues,
  isVenueKind,
  listLiveCities,
  liveOfferCounts,
  VENUE_KINDS,
} from '../_queries';
import { platformCoverage, venueKindCounts } from './_data';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Explore',
  description: `Every venue on ${BRAND.name}, and the offers live at them right now.`,
};

export const dynamic = 'force-dynamic';

interface Query {
  q?: string;
  kind?: string;
  city?: string;
}

/** Rebuilds the query string with one key changed, so a chip keeps the search box. */
function href(current: Query, patch: Query): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `/explore?${qs}` : '/explore';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Query> }) {
  await currentActor();
  const params = await searchParams;

  const q = params.q?.trim() ?? '';
  const kind = params.kind && isVenueKind(params.kind) ? params.kind : undefined;
  const citySlug = params.city?.trim() || undefined;
  const current: Query = {
    ...(q ? { q } : {}),
    ...(kind ? { kind } : {}),
    ...(citySlug ? { city: citySlug } : {}),
  };
  const filtered = Boolean(q || kind || citySlug);

  const [venueRows, cities, deals, coverage, kindCounts] = await Promise.all([
    discoverVenues({ ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(citySlug ? { citySlug } : {}) }),
    listLiveCities(),
    // Every live offer, once. The grid attaches each one to the venue it runs
    // at, and the section at the bottom shows the soonest to close — two views
    // of the same rows rather than two queries that could disagree.
    listLiveDeals({ limit: 100 }),
    platformCoverage(),
    venueKindCounts(citySlug),
  ]);

  const offerCounts = await liveOfferCounts(venueRows.map((r) => r.venue.id));

  const dealsByVenue = new Map<string, LiveDeal[]>();
  for (const deal of deals) {
    if (!deal.venue) continue;
    const list = dealsByVenue.get(deal.venue.publicRef);
    if (list) list.push(deal);
    else dealsByVenue.set(deal.venue.publicRef, [deal]);
  }

  const cityName = citySlug ? (cities.find((c) => c.slug === citySlug)?.name ?? null) : null;

  // With a filter on, the section below shows offers at the venues on screen —
  // so "closing soonest" always means "closing soonest in what you are looking
  // at" rather than somewhere the filter has just excluded.
  const onScreen = new Set(venueRows.map((r) => r.venue.publicRef));
  const shownDeals = (filtered ? deals.filter((d) => d.venue && onScreen.has(d.venue.publicRef)) : deals).slice(0, 4);

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Discover"
        title="Explore"
        lede={
          coverage.venues === 0
            ? `No venue has been brought onto ${BRAND.name} yet. When a partner adds one it appears here the same day.`
            : `${plural(coverage.venues, 'venue')} from ${plural(coverage.businesses, 'business', 'businesses')} across ${plural(coverage.cities, 'live city', 'live cities')}. That is the whole list — ${BRAND.name} shows the places its partners have brought on, not a directory of everywhere.`
        }
        actions={
          <div className="row-wrap">
            <ButtonLink href="/deals" size="sm" variant="primary">
              Live deals
            </ButtonLink>
          </div>
        }
      />

      {/* ── the filter rail ── */}
      <section aria-labelledby="filter-heading" className="stack stack-3">
        <h2 id="filter-heading" className="sr-only">
          Narrow the list
        </h2>

        <Card className="card-sunken">
          <form method="get" action="/explore" className="discover-filter" role="search">
            <div className="field grow">
              <label className="label" htmlFor="explore-q">
                Search venues
              </label>
              <input
                className="input"
                id="explore-q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="A name or a locality"
                autoComplete="off"
              />
            </div>

            {cities.length > 0 ? (
              <div className="field">
                <label className="label" htmlFor="explore-city">
                  City
                </label>
                <select className="select input" id="explore-city" name="city" defaultValue={citySlug ?? ''}>
                  <option value="">Every live city</option>
                  {cities.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                      {c.state ? `, ${c.state}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {/* Carried through the form so searching does not silently drop the chip. */}
            {kind ? <input type="hidden" name="kind" value={kind} /> : null}

            <div className="discover-filter-go">
              <Button type="submit" variant="primary">
                Search
              </Button>
              {filtered ? (
                <ButtonLink href="/explore" variant="ghost">
                  Clear
                </ButtonLink>
              ) : null}
            </div>
          </form>
        </Card>

        <nav aria-label="Filter by venue type" className="segmented">
          <Link className="segment" href={href(current, { kind: '' })} aria-current={kind ? undefined : 'page'}>
            All types
          </Link>
          {VENUE_KINDS.filter((k) => (kindCounts.get(k) ?? 0) > 0 || kind === k).map((k) => (
            <Link
              key={k}
              className="segment"
              href={href(current, { kind: k })}
              aria-current={kind === k ? 'page' : undefined}
            >
              {labelKind(k)}
              <span className="count">{kindCounts.get(k) ?? 0}</span>
            </Link>
          ))}
        </nav>
      </section>

      {/* ── the venues ── */}
      <section aria-labelledby="venues-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="venues-heading">
            {filtered
              ? `${plural(venueRows.length, 'venue')} match${venueRows.length === 1 ? 'es' : ''}`
              : 'Every venue'}
          </h2>
          {filtered ? (
            <Link className="small" href="/explore">
              Clear filters
            </Link>
          ) : cityName ? null : (
            <span className="small muted">Alphabetical</span>
          )}
        </div>

        {venueRows.length > 0 ? (
          <ul className="venues stagger">
            {venueRows.map(({ venue, city, organization }) => {
              const liveHere = offerCounts.get(venue.id) ?? 0;
              const venueDeals = dealsByVenue.get(venue.publicRef) ?? [];
              const shown = venueDeals.slice(0, 2);
              const hidden = Math.max(0, liveHere - shown.length);

              return (
                <li key={venue.publicRef} className="venue">
                  <article className="venue-card">
                    <Poster kind={venue.kind} seed={venue.publicRef} city={city?.name ?? null} ratio="16 / 9" />

                    <div className="venue-body">
                      <div className="row-between" style={{ alignItems: 'flex-start', gap: 10 }}>
                        <div className="grow" style={{ minWidth: 0 }}>
                          <h3 className="h3">{venue.name}</h3>
                          <p className="small muted" style={{ marginTop: 2 }}>
                            {[venue.locality, city?.name, organization?.name].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <Badge tone="neutral">{labelKind(venue.kind)}</Badge>
                      </div>

                      {venue.tags.length > 0 ? (
                        <p className="tiny muted venue-tags">{venue.tags.slice(0, 4).join(' · ')}</p>
                      ) : null}

                      {shown.length > 0 ? (
                        <ul className="venue-offers">
                          {shown.map((deal) => (
                            <li key={deal.publicRef}>
                              <Link className="venue-offer" href={`/deals/${deal.publicRef}`}>
                                <span className="venue-offer-title">{deal.title}</span>
                                <span className="venue-offer-meta">
                                  {deal.priceMinor !== null ? (
                                    <span className="num">{formatMoney(deal.priceMinor, deal.currency)}</span>
                                  ) : (
                                    <span className="tiny muted">Points only</span>
                                  )}
                                  <Countdown
                                    endsAt={deal.endsAt.toISOString()}
                                    secondsRemaining={deal.secondsRemaining}
                                    className="badge badge-accent"
                                  />
                                </span>
                              </Link>
                            </li>
                          ))}
                          {hidden > 0 ? (
                            <li className="tiny muted">
                              and {plural(hidden, 'more offer')} running here
                            </li>
                          ) : null}
                        </ul>
                      ) : (
                        <p className="tiny muted venue-quiet">
                          <Glyph name="clock" size={14} /> Nothing running here right now
                          {venue.typicalSpendMinor
                            ? ` · usually about ${formatMoney(venue.typicalSpendMinor)} a head`
                            : ''}
                        </p>
                      )}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : (
          <Card>
            <Empty
              title={filtered ? 'Nothing matches those filters' : 'No venues are listed yet'}
              body={
                filtered
                  ? 'Try a shorter search, another category, or a different city. The list is small enough that a broad search is usually the right one.'
                  : `Venues appear here as partners bring them onto ${BRAND.name}. Nothing is being held back.`
              }
              action={filtered ? <ButtonLink href="/explore">Clear filters</ButtonLink> : undefined}
            />
          </Card>
        )}
      </section>

      {/* ── closing soonest ── */}
      <section aria-labelledby="live-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="live-heading">{filtered ? 'Closing soonest in this slice' : 'Closing soonest'}</h2>
          <Link className="small" href="/deals">
            All live deals
          </Link>
        </div>
        {shownDeals.length > 0 ? (
          <ul className="grid grid-2 stagger">
            {shownDeals.map((deal) => (
              <DealCard key={deal.publicRef} deal={deal} />
            ))}
          </ul>
        ) : (
          <Card>
            <Empty
              title="No offer is open in this slice"
              body="Deals run in short windows against real capacity, so an empty list means nothing is open at the moment — not that something failed to load."
            />
          </Card>
        )}
      </section>

      {/* ── the two other ways into a city ── */}
      <section aria-labelledby="city-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="city-heading">Across a whole city</h2>
        </div>
        <ul className="grid grid-2">
          <Card as="li" className="stack stack-3">
            <div className="row-between">
              <h3 className="h4">City Pass</h3>
              <StatusChip featureKey="city-pass" />
            </div>
            <p className="small muted">
              One pass across a city&rsquo;s partners. The pass and everything it covers are listed from real
              rows — nothing sells one yet, and the screen says so rather than offering a button.
            </p>
            <div className="row-wrap push-end">
              <ButtonLink href="/city-pass" size="sm">
                See what it covers
              </ButtonLink>
            </div>
          </Card>

          <Card as="li" className="stack stack-3">
            <div className="row-between">
              <h3 className="h4">City Explorer</h3>
              <StatusChip featureKey="quests" />
            </div>
            <p className="small muted">
              Quests that ask you to visit a number of different places of a kind. The quests are real; nothing
              credits a step yet, which the board states on every one of them.
            </p>
            <div className="row-wrap push-end">
              <ButtonLink href="/explore-quests" size="sm">
                See the quests
              </ButtonLink>
            </div>
          </Card>
        </ul>
      </section>
    </div>
  );
}
