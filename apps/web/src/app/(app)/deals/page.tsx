/**
 * Live deals — real capacity at a lower price, for a window that closes.
 *
 * `listLiveDeals` already returns them expiring-first and already drops anything
 * with no capacity left, so this page adds no ordering of its own — a second
 * sort here would be a second opinion about which deal matters, and the
 * service's one is right.
 *
 * The filters are in the URL and applied on the server. Two of them go to the
 * service: `city` becomes the offer's own `cityId`, and `kind` becomes the
 * venue kinds it filters on. The third, the search box, is applied here over
 * the whole live set rather than in SQL — there is no text index on offers, and
 * the live set is small enough to be read in full, which is why the heading says
 * how many were searched. If that ever stops being true the search belongs in
 * the query, not in a bigger limit.
 *
 * The only client code on the page is the countdown inside each card.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, Card, Empty, Notice, PageHead } from '@/components/ui';
import { DealCard } from '@/components/consumer/deal-card';
import { labelKind } from '@/components/consumer/format';
import { listLiveDeals } from '@/lib/commerce/offers';
import { currentActor, isVenueKind, listLiveCities, VENUE_KINDS } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Live deals',
  description: `Short-window offers from ${BRAND.name} partners, expiring first.`,
};

export const dynamic = 'force-dynamic';

interface Query {
  q?: string;
  kind?: string;
  city?: string;
}

function href(current: Query, patch: Query): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `/deals?${qs}` : '/deals';
}

export default async function DealsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await currentActor();
  const params = await searchParams;

  const q = params.q?.trim() ?? '';
  const kind = params.kind && isVenueKind(params.kind) ? params.kind : undefined;
  const citySlug = params.city?.trim() || undefined;

  const cities = await listLiveCities();
  const city = citySlug ? (cities.find((c) => c.slug === citySlug) ?? null) : null;
  const current: Query = {
    ...(q ? { q } : {}),
    ...(kind ? { kind } : {}),
    ...(city ? { city: city.slug } : {}),
  };
  const filtered = Boolean(q || kind || city);

  // Everything live, then the text filter. `listLiveDeals` caps at 100, and the
  // count below is the number this page actually looked at — not an estimate of
  // how many exist.
  const live = await listLiveDeals({
    limit: 100,
    ...(kind ? { venueKinds: [kind] } : {}),
    ...(city ? { cityId: city.id } : {}),
  });

  const needle = q.toLowerCase();
  const deals = needle
    ? live.filter((deal) =>
        [deal.title, deal.description, deal.venue?.name, deal.venue?.locality]
          .filter((v): v is string => Boolean(v))
          .some((value) => value.toLowerCase().includes(needle)),
      )
    : live;

  const soonest = deals[0];
  const totalSaving = deals.reduce((sum, d) => sum + d.savedMinor, 0);

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Expiring first"
        title="Live deals"
        lede={
          deals.length > 0
            ? `${deals.length} open right now. Every one is real capacity at a real venue, held for a window that closes — what you see is what is still bookable.`
            : 'A deal is a short window a partner opens against capacity they actually have. Nothing is open at the moment.'
        }
        actions={
          <ButtonLink href="/explore" size="sm" variant="ghost">
            Browse venues
          </ButtonLink>
        }
      />

      <section aria-labelledby="filter-heading" className="stack stack-3">
        <h2 id="filter-heading" className="sr-only">
          Narrow the list
        </h2>

        <Card className="card-sunken">
          <form method="get" action="/deals" className="discover-filter" role="search">
            <div className="field grow">
              <label className="label" htmlFor="deals-q">
                Search deals
              </label>
              <input
                className="input"
                id="deals-q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="A venue, a locality, or what the offer is"
                autoComplete="off"
              />
            </div>

            {cities.length > 0 ? (
              <div className="field">
                <label className="label" htmlFor="deals-city">
                  City
                </label>
                <select className="select input" id="deals-city" name="city" defaultValue={city?.slug ?? ''}>
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

            {kind ? <input type="hidden" name="kind" value={kind} /> : null}

            <div className="discover-filter-go">
              <button type="submit" className="btn btn-primary">
                Search
              </button>
              {filtered ? (
                <ButtonLink href="/deals" variant="ghost">
                  Clear
                </ButtonLink>
              ) : null}
            </div>
          </form>
        </Card>

        <nav aria-label="Filter by venue type" className="segmented">
          <Link className="segment" href={href(current, { kind: '' })} aria-current={kind ? undefined : 'page'}>
            All
          </Link>
          {VENUE_KINDS.map((k) => (
            <Link
              key={k}
              className="segment"
              href={href(current, { kind: k })}
              aria-current={kind === k ? 'page' : undefined}
            >
              {labelKind(k)}
            </Link>
          ))}
        </nav>
      </section>

      {soonest && soonest.secondsRemaining < 3600 ? (
        <Notice tone="warn">
          The deal at the top closes in under an hour. Capacity is released back to the venue the moment it
          does, so the price goes with it.
        </Notice>
      ) : null}

      {deals.length > 0 ? (
        <>
          <ul className="grid grid-2 stagger">
            {deals.map((deal) => (
              <DealCard key={deal.publicRef} deal={deal} />
            ))}
          </ul>
          {totalSaving > 0 ? (
            <p className="small muted">
              Prices and savings are the partner&rsquo;s own, computed from the slot&rsquo;s list price when the
              offer was published — never recomputed on this screen, and never taken from the URL.
            </p>
          ) : null}
        </>
      ) : (
        <Card>
          <Empty
            title={
              filtered
                ? 'Nothing open matches that'
                : 'No deals are live right now'
            }
            body={
              filtered
                ? `${live.length === 0 ? 'Nothing at all is open in that slice.' : `${live.length} deal${live.length === 1 ? ' is' : 's are'} open, and none of them matches those words.`} Deals last minutes to hours, so the list changes through the day.`
                : 'Partners publish deals against real capacity, so the list is empty whenever none of them has a window open. It is not a failure to load.'
            }
            action={
              filtered ? (
                <ButtonLink href="/deals">Clear the filters</ButtonLink>
              ) : (
                <ButtonLink href="/explore">Explore venues instead</ButtonLink>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
