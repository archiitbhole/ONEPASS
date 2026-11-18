/**
 * The route explorer.
 *
 * One route at a time, in depth: what it costs now against what it has cost,
 * how the price moves with how far ahead you look, which airlines fly it and
 * how they compare. Everything on one page because these are not four questions,
 * they are one question asked four ways.
 *
 * The lead-time table is the part worth being careful about. It shows what has
 * been observed at each booking distance on this route — it does *not* predict
 * what a particular fare will do as its departure approaches, and the caption
 * says so. Those are different claims and only the first is supported by rows.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  Empty,
  Stack,
  Stat,
  StatRow,
  TableScroll,
} from '@/components/ui';
import { PriceChart, RoutePicker, SampleNote } from '@/components/travel/airindex-ui';
import { comparison, duration, indexTone, rupees } from '@/components/travel/format';
import {
  MIN_SAMPLE,
  REFERENCE_WINDOW_DAYS,
  airlineComparison,
  fareIndex,
  leadTimeBands,
  priceHistory,
  rankedRoutes,
  routeFigures,
} from '@/lib/travel/airindex';
import { listAirports } from '../../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Route explorer · AirIndex',
  description: 'What one route has actually cost — the index, the history, the airlines and the sample behind each figure.',
};

export const dynamic = 'force-dynamic';

const IATA = /^[A-Z]{3}$/;

export default async function RouteExplorerPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; cabin?: string }>;
}) {
  const query = await searchParams;
  const origin = (query.from ?? '').trim().toUpperCase();
  const destination = (query.to ?? '').trim().toUpperCase();
  const cabin =
    query.cabin === 'BUSINESS' || query.cabin === 'PREMIUM_ECONOMY' || query.cabin === 'FIRST'
      ? (query.cabin as 'BUSINESS' | 'PREMIUM_ECONOMY' | 'FIRST')
      : query.cabin === 'ALL'
        ? null
        : 'ECONOMY';

  const chosen = IATA.test(origin) && IATA.test(destination) && origin !== destination;
  const [airports, popular] = await Promise.all([listAirports(), rankedRoutes(12)]);

  const data = chosen
    ? await Promise.all([
        fareIndex({ origin, destination, cabin }),
        routeFigures({ origin, destination, cabin }),
        priceHistory({ origin, destination, days: 90, cabin }),
        airlineComparison({ origin, destination, cabin }),
        leadTimeBands({ origin, destination, cabin }),
      ])
    : null;

  const [index, figures, history, carriers, bands] = data ?? [null, null, [], [], []];

  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap">
      <Stack gap={5}>

        <header className="stack stack-2">
          <p className="eyebrow">
            <Link href="/travel/airindex">AirIndex</Link> · Route explorer
          </p>
          <h1 className="h1">{chosen ? `${origin} → ${destination}` : 'Route explorer'}</h1>
          <p className="lede">
            Pick a route and see what it has actually been costing — with the number of observations
            behind every figure, and nothing published from a sample too thin to mean anything.
          </p>
        </header>

        <Card>
          <Stack gap={3}>
            <CardHead title="Choose a route" />
            <RoutePicker
              airports={airports}
              origin={origin}
              destination={destination}
              action="/travel/airindex/routes"
              extra={
                <label className="op-picker-field">
                  <span className="label">Cabin</span>
                  <select name="cabin" className="input" defaultValue={cabin ?? 'ALL'}>
                    <option value="ECONOMY">Economy</option>
                    <option value="PREMIUM_ECONOMY">Premium economy</option>
                    <option value="BUSINESS">Business</option>
                    <option value="FIRST">First</option>
                    <option value="ALL">Every cabin</option>
                  </select>
                </label>
              }
            />
            {popular.length > 0 ? (
              <p className="tiny muted">
                Routes with data:{' '}
                {popular.map((route, i) => (
                  <span key={`${route.originCode}-${route.destinationCode}`}>
                    {i > 0 ? ' · ' : ''}
                    <Link href={`/travel/airindex/routes?from=${route.originCode}&to=${route.destinationCode}`}>
                      {route.originCode}–{route.destinationCode}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </Stack>
        </Card>

        {!chosen ? (
          <Empty
            title="Pick a route"
            body={`Enter two airport codes above, or choose one of the routes ${BRAND.name} has observations for.`}
          />
        ) : figures && figures.sampleSize === 0 ? (
          <Empty
            title="Nothing observed on this route"
            body={`AirIndex only knows what this deployment has searched. Search ${origin} to ${destination} and the first observations are recorded — a route needs ${MIN_SAMPLE} before anything is published.`}
            action={<ButtonLink href={`/travel/flights/results?from=${origin}&to=${destination}&depart=${tomorrow()}`}>Search this route</ButtonLink>}
          />
        ) : (
          <>
            <Card>
              <Stack gap={4}>
                <CardHead title="Where the price sits now" />
                {index?.index === null ? (
                  <>
                    <p className="small">{index.verdict}</p>
                    <SampleNote
                      sampleSize={(index?.currentSample ?? 0) + (index?.referenceSample ?? 0)}
                      minimum={MIN_SAMPLE}
                    />
                  </>
                ) : (
                  <>
                    <div className="op-index-hero">
                      <span className="op-index-number">{index!.index}</span>
                      <Badge tone={indexTone(index!.index)}>{index!.verdict}</Badge>
                    </div>
                    <StatRow>
                      <Stat
                        label="Last 7 days"
                        value={index!.currentMedianMinor ? rupees(index!.currentMedianMinor) : '—'}
                        hint={`Median of ${index!.currentSample.toLocaleString('en-IN')} observations`}
                        tone={indexTone(index!.index)}
                      />
                      <Stat
                        label="Reference"
                        value={index!.referenceMedianMinor ? rupees(index!.referenceMedianMinor) : '—'}
                        hint={`Median of the ${index!.referenceSample.toLocaleString('en-IN')} before that, over 90 days`}
                      />
                      <Stat
                        label="Typical range"
                        value={
                          figures?.p25Minor && figures.p75Minor
                            ? `${rupees(figures.p25Minor)} – ${rupees(figures.p75Minor)}`
                            : '—'
                        }
                        hint="Middle half of every observation"
                      />
                      <Stat
                        label="Lowest seen"
                        value={figures?.minMinor ? rupees(figures.minMinor) : '—'}
                        hint={figures?.maxMinor ? `Highest ${rupees(figures.maxMinor)}` : undefined}
                        tone="ok"
                      />
                    </StatRow>
                    <p className="small muted">
                      The index is the last seven days’ median divided by the ninety days before them,
                      times a hundred. The reference window deliberately excludes the current one — a week
                      of high fares must not raise the baseline it is being compared against.
                    </p>
                    <SampleNote
                      sampleSize={figures?.sampleSize ?? 0}
                      minimum={MIN_SAMPLE}
                      from={figures?.observedFrom}
                      to={figures?.observedTo}
                    />
                  </>
                )}
              </Stack>
            </Card>

            {history.length >= 2 ? (
              <Card>
                <Stack gap={3}>
                  <CardHead
                    title="How it has moved"
                    action={
                      <ButtonLink
                        href={`/travel/airindex/history?from=${origin}&to=${destination}`}
                        variant="ghost"
                      >
                        Longer view
                      </ButtonLink>
                    }
                  />
                  <PriceChart points={history} label={`Median fare, ${origin} to ${destination}, last 90 days`} />
                  <p className="tiny muted">
                    Each point is the median of the fares observed that day, in India. Days with no
                    searches are absent rather than interpolated.
                  </p>
                </Stack>
              </Card>
            ) : null}

            {carriers.length > 0 ? (
              <Card>
                <Stack gap={3}>
                  <CardHead
                    title="Airlines on this route"
                    action={
                      <ButtonLink
                        href={`/travel/airindex/airlines?from=${origin}&to=${destination}`}
                        variant="ghost"
                      >
                        Full comparison
                      </ButtonLink>
                    }
                  />
                  <TableScroll>
                    <table className="table">
                      <caption className="sr-only">
                        Median fare and typical journey time for each airline observed on this route
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Airline</th>
                          <th scope="col" className="num">
                            Median
                          </th>
                          <th scope="col" className="num">
                            Lowest
                          </th>
                          <th scope="col">Against the route</th>
                          <th scope="col" className="num">
                            Typical time
                          </th>
                          <th scope="col" className="num">
                            Observations
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {carriers.map((carrier) => (
                          <tr key={carrier.carrier}>
                            <th scope="row">
                              {carrier.name ?? carrier.carrier}{' '}
                              {carrier.isLowCost ? <Badge tone="neutral">low cost</Badge> : null}
                            </th>
                            <td className="num">{rupees(carrier.medianMinor)}</td>
                            <td className="num">{rupees(carrier.minMinor)}</td>
                            <td>
                              <Badge
                                tone={
                                  carrier.versusRouteMedian === null
                                    ? 'neutral'
                                    : carrier.versusRouteMedian < 0
                                      ? 'ok'
                                      : carrier.versusRouteMedian > 0
                                        ? 'warn'
                                        : 'neutral'
                                }
                              >
                                {comparison(carrier.versusRouteMedian)}
                              </Badge>
                            </td>
                            <td className="num">{duration(carrier.averageDurationMinutes)}</td>
                            <td className="num">{carrier.sampleSize.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                  <p className="tiny muted">
                    An airline with fewer than {MIN_SAMPLE} observations on this route is left out rather
                    than shown with a figure that thin.
                  </p>
                </Stack>
              </Card>
            ) : null}

            <Card>
              <Stack gap={3}>
                <CardHead title="By how far ahead the search was" />
                <TableScroll>
                  <table className="table">
                    <caption className="sr-only">
                      Median fare observed at each booking distance on this route
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Booked</th>
                        <th scope="col" className="num">
                          Median fare
                        </th>
                        <th scope="col" className="num">
                          Observations
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {bands.map((band) => (
                        <tr key={band.label}>
                          <th scope="row">{band.label}</th>
                          <td className="num">
                            {band.medianMinor === null ? (
                              <span className="small muted">not enough data</span>
                            ) : (
                              rupees(band.medianMinor)
                            )}
                          </td>
                          <td className="num">{band.sampleSize.toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
                <p className="tiny muted">
                  This is what has been <em>observed</em> at each booking distance on this route over the
                  last {REFERENCE_WINDOW_DAYS} days. It is not a prediction of what one particular fare
                  will do as its departure approaches — a different claim, and not one these rows support.
                </p>
              </Stack>
            </Card>

            <div className="row-wrap">
              <ButtonLink href={`/travel/flights/results?from=${origin}&to=${destination}&depart=${tomorrow()}`}>
                Search this route
              </ButtonLink>
              <ButtonLink
                href={`/travel/airindex/observations?from=${origin}&to=${destination}`}
                variant="ghost"
              >
                See the observations themselves
              </ButtonLink>
            </div>
          </>
        )}
      </Stack>
    </div>
  );
}

/** A sensible default departure for a "search this route" link: a fortnight out. */
function tomorrow(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(Date.now() + 14 * 86_400_000),
  );
}
