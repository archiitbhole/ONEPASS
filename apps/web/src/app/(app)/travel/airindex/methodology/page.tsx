/**
 * How AirIndex is computed.
 *
 * Written out in full, including the parts that make it weaker, because a
 * methodology page that only lists strengths is marketing. The three things it
 * has to say: what the numbers mean, how they are calculated, and what they
 * cannot support.
 *
 * The constants are imported rather than typed into the prose — a page that says
 * "twelve observations" while the code uses fifteen is worse than no page, and
 * this way the two cannot drift.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, Card, CardHead, Notice, Stack } from '@/components/ui';
import { CURRENT_WINDOW_DAYS, MIN_SAMPLE, REFERENCE_WINDOW_DAYS } from '@/lib/travel/airindex';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Methodology · AirIndex',
  description:
    'Exactly how the fare index, the medians and the comparisons are computed — and what they cannot tell you.',
};

export default function MethodologyPage() {
  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap">
      <Stack gap={5}>

        <header className="stack stack-2">
          <p className="eyebrow">
            <Link href="/travel/airindex">AirIndex</Link> · Methodology
          </p>
          <h1 className="h1">How AirIndex is computed</h1>
          <p className="lede">
            Every figure comes from one table of observed prices, aggregated when you ask for it. Nothing
            is precomputed into a score, and there is no number anywhere in AirIndex that somebody could
            type in.
          </p>
        </header>

        <Card>
          <Stack gap={3}>
            <CardHead title="What an observation is" />
            <div className="op-prose">
              <p>
                Every time somebody searches for a flight, each fare that comes back is recorded: the
                route, the departure date, the airline, the cabin, the number of stops, the journey time,
                how many days ahead the search was, the price per passenger, and which source quoted it.
              </p>
              <p>
                <strong>Per passenger</strong> matters. A family of four searching and a solo traveller
                searching produce comparable figures because the price is divided before it is stored —
                otherwise a route would look expensive simply because larger parties happened to search
                it.
              </p>
              <p>
                The table is append-only in practice: there is no code path in {BRAND.name} that updates an
                observation. A wrong observation is still a correct record of what a provider said.
              </p>
            </div>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <CardHead title="The fare index" />
            <p className="op-formula">Fare Index = (current median ÷ reference median) × 100</p>
            <div className="op-prose">
              <p>
                The <strong>current median</strong> is the middle price observed on that route over the
                last {CURRENT_WINDOW_DAYS} days.
              </p>
              <p>
                The <strong>reference median</strong> is the middle price over the {REFERENCE_WINDOW_DAYS}{' '}
                days before that — and it <em>excludes</em> the current window. That exclusion is
                deliberate and is the single most important detail on this page: if the reference
                included the present, a week of high fares would raise the baseline it was being measured
                against, damping exactly the signal the index exists to show.
              </p>
              <p>
                So 100 means this week looks like the three months before it. 130 means fares are about a
                third above that. 75 means about a quarter below.
              </p>
              <p>
                Both windows need at least {MIN_SAMPLE} observations. If either is thinner, no index is
                published — not a greyed-out one, not an approximate one. The page says there is not
                enough data.
              </p>
            </div>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <CardHead title="Why medians rather than averages" />
            <div className="op-prose">
              <p>
                A single business-class fare on a route otherwise flown by budget travellers moves an
                average a long way and a median not at all. Airline pricing is full of exactly that kind
                of outlier, so every central figure here is a median, computed in the database with{' '}
                <code>percentile_cont</code> rather than in application code.
              </p>
              <p>
                The 25th and 75th percentiles are published alongside, because the spread is often more
                useful than the middle. A route whose middle half spans ₹800 is a route where shopping
                around earns very little; one that spans ₹6,000 is a route where it earns a great deal.
              </p>
            </div>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <CardHead title="The sample threshold" />
            <div className="op-prose">
              <p>
                No figure is published from fewer than <strong>{MIN_SAMPLE} observations</strong>. That is
                a product decision rather than a statistical one: {MIN_SAMPLE} is roughly one search’s
                worth of results, so a route somebody has glanced at once does not acquire an index.
              </p>
              <p>
                Below the threshold, the answer is nothing at all — no estimate, no confidence interval,
                no faded number. A confident-looking figure computed from four rows is worse than an empty
                state, because somebody will act on it.
              </p>
              <p>
                Above the threshold, the sample size appears beside every figure. A median over 2,400
                observations and a median over 13 are different kinds of claim, and a reader who is not
                told which they are looking at has been misled by omission.
              </p>
            </div>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <CardHead title="Directions, cabins and routes" />
            <div className="op-prose">
              <p>
                DEL→BOM and BOM→DEL are treated as different routes, because they are priced differently —
                often substantially. The route explorer can combine them when you ask it to, and says so
                when it has.
              </p>
              <p>
                Cabins are separated for the same reason. An economy median and a business median on the
                same route are two facts, not one.
              </p>
              <p>
                An airline appears in a comparison only if it has {MIN_SAMPLE} observations on that
                specific route in that window. An airline that is cheap between Bengaluru and Chennai
                tells you nothing about Delhi to London.
              </p>
            </div>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <CardHead title="What AirIndex does not do" />
            <Notice tone="info">
              AirIndex reports what has been observed. It does not predict what a fare will do next.
            </Notice>
            <div className="op-prose">
              <p>
                <strong>It is not a forecast.</strong> It knows nothing about fuel prices, aircraft
                availability, festivals, school holidays or an airline’s revenue-management system. The
                lead-time table on a route page shows what has been <em>observed</em> at each booking
                distance — not what one particular fare will do as its departure approaches. Those are
                different claims and only the first is supported.
              </p>
              <p>
                <strong>It is not a census of the market.</strong> It sees the fares this deployment’s
                connected sources returned for the searches its own users ran. That is a real sample and a
                partial one. The <Link href="/travel/airindex/quality">data quality page</Link> reports
                exactly how partial, including the routes it has some data for but not enough.
              </p>
              <p>
                <strong>It does not rate airlines.</strong> {BRAND.name} observes fares, journey times and
                stops. It has no data on punctuality, seat pitch, baggage handling or service, so it
                publishes no score — a rating built from price alone would be an opinion wearing a
                number’s clothes.
              </p>
              <p>
                <strong>It makes no guarantee about cheapness.</strong> Nothing in {BRAND.name} claims to find
                the cheapest fare that exists, because no system that queries a subset of the market can
                honestly claim that. It shows what its sources returned, and how that compares to what
                those same sources have returned before.
              </p>
            </div>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <CardHead title="Check it yourself" />
            <p className="small">
              The observations every figure is computed from are published in full, and downloadable as a
              CSV. That is what makes this a method rather than a claim.
            </p>
            <div className="row-wrap">
              <ButtonLink href="/travel/airindex/observations">See the observations</ButtonLink>
              <ButtonLink href="/travel/airindex/quality" variant="ghost">
                Data quality
              </ButtonLink>
            </div>
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}
