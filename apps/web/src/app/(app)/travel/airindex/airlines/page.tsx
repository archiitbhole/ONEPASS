/**
 * Airline comparison.
 *
 * Three columns that observations support — median fare, typical journey time,
 * and how often the airline flies the route nonstop — and no fourth column that
 * they do not. There is no rating out of five, no service score and no "best
 * value" badge, because ONEPASS has no data on legroom, punctuality or how the
 * crew behaved, and a score invented from price alone would be an opinion
 * wearing a number's clothes.
 *
 * A comparison needs a route: "is IndiGo cheap" has no answer, "is IndiGo cheap
 * between Delhi and Mumbai" does.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, ButtonLink, Card, CardHead, Empty, Stack, TableScroll } from '@/components/ui';
import { RoutePicker, SampleNote } from '@/components/travel/airindex-ui';
import { comparison, duration, rupees } from '@/components/travel/format';
import { MIN_SAMPLE, airlineComparison, rankedRoutes, routeFigures } from '@/lib/travel/airindex';
import { listAirports } from '../../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Airline comparison · AirIndex',
  description: 'How the airlines on a route compare on price, journey time and how often they fly it nonstop.',
};

export const dynamic = 'force-dynamic';

const IATA = /^[A-Z]{3}$/;

export default async function AirlinesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; window?: string }>;
}) {
  const query = await searchParams;
  const origin = (query.from ?? '').trim().toUpperCase();
  const destination = (query.to ?? '').trim().toUpperCase();
  const windowDays = query.window === '7' ? 7 : query.window === '30' ? 30 : query.window === '365' ? 365 : 90;

  const chosen = IATA.test(origin) && IATA.test(destination) && origin !== destination;
  const [airports, popular] = await Promise.all([listAirports(), rankedRoutes(10)]);

  const [carriers, figures] = chosen
    ? await Promise.all([
        airlineComparison({ origin, destination, windowDays }),
        routeFigures({ origin, destination, windowDays }),
      ])
    : [[], null];

  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap">
      <Stack gap={5}>

        <header className="stack stack-2">
          <p className="eyebrow">
            <Link href="/travel/airindex">AirIndex</Link> · Airlines
          </p>
          <h1 className="h1">Airline comparison</h1>
          <p className="lede">
            On one route, over one window. Price, journey time and how often each airline flies it
            nonstop — the three things the observations actually support.
          </p>
        </header>

        <Card>
          <Stack gap={3}>
            <CardHead title="Choose a route" />
            <RoutePicker
              airports={airports}
              origin={origin}
              destination={destination}
              action="/travel/airindex/airlines"
              extra={
                <label className="op-picker-field">
                  <span className="label">Window</span>
                  <select name="window" className="input" defaultValue={String(windowDays)}>
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="365">Last year</option>
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
                    <Link href={`/travel/airindex/airlines?from=${route.originCode}&to=${route.destinationCode}`}>
                      {route.originCode}–{route.destinationCode}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </Stack>
        </Card>

        {!chosen ? (
          <Empty title="Pick a route" body="An airline is cheap or dear on a route, not in general." />
        ) : carriers.length === 0 ? (
          <Empty
            title="Not enough observations on this route"
            body={`An airline needs ${MIN_SAMPLE} observations in this window before a figure is published for it. ${
              figures?.sampleSize ?? 0
            } price${(figures?.sampleSize ?? 0) === 1 ? ' has' : 's have'} been recorded on this route in total.`}
            action={<ButtonLink href="/travel/airindex/routes">Try the route explorer</ButtonLink>}
          />
        ) : (
          <Card>
            <Stack gap={3}>
              <CardHead
                title={`${origin} → ${destination}`}
                action={
                  <ButtonLink href={`/travel/airindex/routes?from=${origin}&to=${destination}`} variant="ghost">
                    Route detail
                  </ButtonLink>
                }
              />
              <TableScroll>
                <table className="table">
                  <caption className="sr-only">
                    Every airline with enough observations on this route, cheapest median first
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Airline</th>
                      <th scope="col" className="num">
                        Median fare
                      </th>
                      <th scope="col" className="num">
                        Lowest seen
                      </th>
                      <th scope="col">Against the route median</th>
                      <th scope="col" className="num">
                        Typical journey
                      </th>
                      <th scope="col" className="num">
                        Nonstop
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
                          {carrier.name ?? carrier.carrier}
                          <span className="tiny muted" style={{ display: 'block' }}>
                            {carrier.carrier}
                            {carrier.isLowCost ? ' · low cost' : ''}
                          </span>
                        </th>
                        <td className="num">{rupees(carrier.medianMinor)}</td>
                        <td className="num">{rupees(carrier.minMinor)}</td>
                        <td>
                          {/* Tone and text both, so the comparison does not rely on
                              colour alone — a badge that is only green or amber is
                              invisible to a third of readers in some lighting. */}
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
                        <td className="num">{Math.round(carrier.directShare * 100)}%</td>
                        <td className="num">{carrier.sampleSize.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>

              <SampleNote
                sampleSize={figures?.sampleSize ?? 0}
                minimum={MIN_SAMPLE}
                from={figures?.observedFrom}
                to={figures?.observedTo}
              />

              <p className="small muted">
                There is deliberately no overall score here. {BRAND.name} observes fares, journey times and
                stops — it has no data on punctuality, seat pitch or service, and a rating built from
                price alone would be an opinion pretending to be a measurement.
              </p>
            </Stack>
          </Card>
        )}
      </Stack>
    </div>
  );
}
