/**
 * Data quality.
 *
 * The page that says how much AirIndex should be trusted, in the product's own
 * words rather than as a score. There is no "quality: 94%" here, because that
 * number would have to be invented — there is no ground truth to measure
 * against, and a fabricated confidence figure is worse than none.
 *
 * What there is instead: how many observations exist, how fresh they are, how
 * many routes have enough and how many do not, which sources they came from, and
 * what the gaps are. Those are facts. A reader can form their own view from them,
 * which is the honest version of a confidence score.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  Notice,
  Stack,
  Stat,
  StatRow,
  TableScroll,
  formatRelative,
} from '@/components/ui';
import { rupees } from '@/components/travel/format';
import {
  CURRENT_WINDOW_DAYS,
  MIN_SAMPLE,
  REFERENCE_WINDOW_DAYS,
  dataQuality,
  rankedRoutes,
} from '@/lib/travel/airindex';
import { providerHealth } from '@/lib/travel/health';
import { knownProviders } from '@/lib/travel/providers/registry';

export const metadata: Metadata = {
  title: 'Data quality · AirIndex',
  description: 'How much data AirIndex has, how fresh it is, where it came from, and where the gaps are.',
};

export const dynamic = 'force-dynamic';

export default async function QualityPage() {
  const [quality, routes, health] = await Promise.all([dataQuality(), rankedRoutes(50), providerHealth()]);
  const providers = knownProviders();

  // Routes with something but not enough. Named rather than counted, because
  // "which routes can you not tell me about" is the question a reader has.
  const thin = await db.execute<{ origin: string; destination: string; sample: number }>(sql`
    select origin_code as origin, destination_code as destination, count(*)::int as sample
    from flight_price_observations
    where observed_at >= now() - ${`${REFERENCE_WINDOW_DAYS} days`}::interval
    group by 1, 2
    having count(*) < ${MIN_SAMPLE}
    order by sample desc
    limit 20
  `);

  const stale =
    quality.newestObservation !== null &&
    Date.now() - quality.newestObservation.getTime() > 7 * 86_400_000;

  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap">
      <Stack gap={5}>

        <header className="stack stack-2">
          <p className="eyebrow">
            <Link href="/travel/airindex">AirIndex</Link> · Data quality
          </p>
          <h1 className="h1">What AirIndex is standing on</h1>
          <p className="lede">
            How much data there is, how fresh it is, and what it cannot tell you. There is deliberately
            no single quality score on this page — there is no ground truth to measure against, and a
            number invented for reassurance would be the least trustworthy thing here.
          </p>
        </header>

        {quality.totalObservations === 0 ? (
          <Notice tone="warn">
            No prices have been observed yet. AirIndex is computed from the searches this deployment runs,
            so it has nothing to report until somebody searches for a flight.
          </Notice>
        ) : null}

        {stale ? (
          <Notice tone="warn">
            The most recent observation is {formatRelative(quality.newestObservation!)}. Figures computed
            from a stale window describe the past rather than the present, and the “last 7 days” index
            will be empty until new searches come in.
          </Notice>
        ) : null}

        <StatRow>
          <Stat
            label="Observations"
            value={quality.totalObservations.toLocaleString('en-IN')}
            hint={`${quality.observationsLast30Days.toLocaleString('en-IN')} in the last 30 days`}
            tone="accent"
          />
          <Stat
            label="In the current window"
            value={quality.observationsLast7Days.toLocaleString('en-IN')}
            hint={`The last ${CURRENT_WINDOW_DAYS} days — what the index divides by the reference`}
          />
          <Stat
            label="Routes publishable"
            value={quality.routesWithEnoughData}
            hint={`Of ${quality.routesCovered} with any data at all`}
            tone={quality.routesWithEnoughData > 0 ? 'ok' : 'warn'}
          />
          <Stat
            label="Airlines seen"
            value={quality.carriersSeen}
            hint={quality.sourcesSeen.length > 0 ? `From ${quality.sourcesSeen.join(', ')}` : undefined}
          />
        </StatRow>

        <Card>
          <Stack gap={3}>
            <CardHead title="Freshness" />
            <dl className="dl">
              <div>
                <dt>Oldest observation</dt>
                <dd>
                  {quality.oldestObservation ? formatRelative(quality.oldestObservation) : 'None recorded'}
                </dd>
              </div>
              <div>
                <dt>Newest observation</dt>
                <dd>
                  {quality.newestObservation ? formatRelative(quality.newestObservation) : 'None recorded'}
                </dd>
              </div>
              <div>
                <dt>Minimum sample before publishing</dt>
                <dd>{MIN_SAMPLE} observations, per figure</dd>
              </div>
              <div>
                <dt>Reference window</dt>
                <dd>
                  {REFERENCE_WINDOW_DAYS} days, excluding the most recent {CURRENT_WINDOW_DAYS}
                </dd>
              </div>
            </dl>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <CardHead title="Where the prices came from" />
            <p className="small">
              An observation is only as good as the source that quoted it, and a source that is not
              connected contributes nothing. This is what each one has actually been doing.
            </p>
            <TableScroll>
              <table className="table">
                <caption className="sr-only">Each flight source, whether it is configured, and how its calls have gone</caption>
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Configured</th>
                    <th scope="col" className="num">
                      Calls
                    </th>
                    <th scope="col" className="num">
                      Succeeded
                    </th>
                    <th scope="col" className="num">
                      Typical latency
                    </th>
                    <th scope="col">Last result</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((provider) => {
                    const row = health.find((entry) => entry.source === provider.id);
                    return (
                      <tr key={provider.id}>
                        <th scope="row">
                          {provider.label}
                          <span className="tiny muted" style={{ display: 'block' }}>
                            {provider.kind === 'sample' ? 'development fixture' : provider.kind.toUpperCase()}
                          </span>
                        </th>
                        <td>
                          <Badge tone={provider.configured ? 'ok' : 'neutral'}>
                            {provider.configured ? 'yes' : 'no'}
                          </Badge>
                        </td>
                        <td className="num">{(row?.callsTotal ?? 0).toLocaleString('en-IN')}</td>
                        <td className="num">
                          {row?.successRate === null || row?.successRate === undefined
                            ? '—'
                            : `${Math.round(row.successRate * 100)}%`}
                        </td>
                        <td className="num">{row?.latencyMsEwma ? `${row.latencyMsEwma}ms` : '—'}</td>
                        <td>
                          {row?.lastResult ? (
                            <Badge tone={row.lastResult === 'OK' ? 'ok' : row.lastResult === 'EMPTY' ? 'neutral' : 'warn'}>
                              {row.lastResult.toLowerCase()}
                            </Badge>
                          ) : (
                            <span className="small muted">never called</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            <p className="tiny muted">
              These counters are this instance’s own record of its calls. A source marked not configured
              has never been asked anything — its adapter exists, but this deployment holds no credentials
              for it.
            </p>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <CardHead title="What AirIndex cannot tell you" />
            <p className="small">
              <strong>It is a sample, not a census.</strong> AirIndex sees the fares this deployment’s
              connected sources returned for the searches its own users ran. A route nobody searches has
              no data; an airline no connected source resells never appears; and a fare that exists only
              on an airline’s own website is invisible here.
            </p>
            {thin.length > 0 ? (
              <>
                <p className="small">
                  <strong>{thin.length} route{thin.length === 1 ? ' has' : 's have'} some data but not enough.</strong>{' '}
                  Nothing is published about {thin.length === 1 ? 'it' : 'them'}:
                </p>
                <p className="small muted">
                  {thin.map((row, i) => (
                    <span key={`${row.origin}-${row.destination}`}>
                      {i > 0 ? ' · ' : ''}
                      {row.origin}–{row.destination} ({row.sample})
                    </span>
                  ))}
                </p>
              </>
            ) : null}
            <p className="small">
              <strong>It is not a forecast.</strong> Nothing here predicts a price. The lead-time table
              on a route page shows what has been observed at each booking distance — not what one
              particular fare will do as its departure approaches.
            </p>
          </Stack>
        </Card>

        {routes.length > 0 ? (
          <Card>
            <Stack gap={3}>
              <CardHead
                title="Coverage by route"
                action={<ButtonLink href="/travel/airindex/observations" variant="ghost">The raw rows</ButtonLink>}
              />
              <TableScroll>
                <table className="table">
                  <caption className="sr-only">Every route with enough observations to publish, by sample size</caption>
                  <thead>
                    <tr>
                      <th scope="col">Route</th>
                      <th scope="col" className="num">
                        Observations
                      </th>
                      <th scope="col" className="num">
                        Airlines
                      </th>
                      <th scope="col" className="num">
                        Median
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((route) => (
                      <tr key={`${route.originCode}-${route.destinationCode}`}>
                        <th scope="row">
                          <Link href={`/travel/airindex/routes?from=${route.originCode}&to=${route.destinationCode}`}>
                            {route.originCode} → {route.destinationCode}
                          </Link>
                        </th>
                        <td className="num">{route.sampleSize.toLocaleString('en-IN')}</td>
                        <td className="num">{route.carriers}</td>
                        <td className="num">{rupees(route.medianMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </div>
  );
}
