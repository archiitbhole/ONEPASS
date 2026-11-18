/**
 * AirIndex — the front door.
 *
 * What it is, in one sentence at the top, and then the routes it can actually
 * say something about. The sentence matters: an index nobody understands is a
 * number people either ignore or over-trust, and both are worse than no number.
 *
 * Every route here has at least the minimum sample. Routes with some
 * observations but not enough are counted on the quality page rather than shown
 * with a greyed-out figure, because a greyed-out figure still reads as a figure.
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
import { indexTone, rupees } from '@/components/travel/format';
import { MIN_SAMPLE, dataQuality, fareIndex, rankedRoutes } from '@/lib/travel/airindex';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'AirIndex',
  description:
    `What flights have actually been costing, computed from prices ${BRAND.name} has observed — with the sample size beside every figure.`,
};

export const dynamic = 'force-dynamic';

export default async function AirIndexPage() {
  const [quality, routes] = await Promise.all([dataQuality(), rankedRoutes(20)]);

  const indexed = await Promise.all(
    routes.map(async (route) => ({
      route,
      index: await fareIndex({ origin: route.originCode, destination: route.destinationCode }),
    })),
  );

  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap">
      <Stack gap={5}>

        <header className="stack stack-2">
          <p className="eyebrow">
            <Link href="/travel">Travel</Link> · AirIndex
          </p>
          <h1 className="h1">AirIndex</h1>
          <p className="lede">
            An index of 100 means fares on a route are about what they have been over the last three
            months. Higher is dearer than usual, lower is cheaper. Every figure is a median over prices
            this system has recorded while people searched — not a forecast, and not a claim from anybody
            else.
          </p>
        </header>

        <StatRow>
          <Stat
            label="Prices observed"
            value={quality.totalObservations.toLocaleString('en-IN')}
            hint={`${quality.observationsLast7Days.toLocaleString('en-IN')} in the last seven days`}
            tone="accent"
          />
          <Stat
            label="Routes with enough data"
            value={quality.routesWithEnoughData}
            hint={`${quality.routesBelowThreshold} more have some, but fewer than ${MIN_SAMPLE}`}
          />
          <Stat label="Airlines seen" value={quality.carriersSeen} />
          <Stat
            label="Sources"
            value={quality.sourcesSeen.length === 0 ? '—' : quality.sourcesSeen.join(', ')}
            hint="Where these prices came from"
          />
        </StatRow>

        <div className="row-wrap">
          <ButtonLink href="/travel/airindex/routes">Route explorer</ButtonLink>
          <ButtonLink href="/travel/airindex/airlines" variant="ghost">
            Compare airlines
          </ButtonLink>
          <ButtonLink href="/travel/airindex/history" variant="ghost">
            Price history
          </ButtonLink>
          <ButtonLink href="/travel/airindex/observations" variant="ghost">
            The raw observations
          </ButtonLink>
          <ButtonLink href="/travel/airindex/quality" variant="ghost">
            Data quality
          </ButtonLink>
          <ButtonLink href="/travel/airindex/methodology" variant="ghost">
            Methodology
          </ButtonLink>
        </div>

        <Card>
          <Stack gap={3}>
            <CardHead title="Routes" />
            {indexed.length === 0 ? (
              <Empty
                title="Nothing observed yet"
                body="AirIndex is computed from the searches this deployment runs. Search for a flight and the first observations are recorded — a route needs a dozen before anything is published about it."
                action={<ButtonLink href="/travel/flights">Search flights</ButtonLink>}
              />
            ) : (
              <TableScroll>
                <table className="table">
                  <caption className="sr-only">
                    Routes {BRAND.name} has enough observations for, with the fare index and typical price
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Route</th>
                      <th scope="col">Index</th>
                      <th scope="col" className="num">
                        Usual fare
                      </th>
                      <th scope="col" className="num">
                        Airlines
                      </th>
                      <th scope="col" className="num">
                        Observations
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {indexed.map(({ route, index }) => (
                      <tr key={`${route.originCode}-${route.destinationCode}`}>
                        <th scope="row">
                          <Link
                            href={`/travel/airindex/routes?from=${route.originCode}&to=${route.destinationCode}`}
                          >
                            {route.originCode} → {route.destinationCode}
                          </Link>
                          <span className="small muted" style={{ display: 'block' }}>
                            {route.originCity ?? route.originCode} to {route.destinationCity ?? route.destinationCode}
                          </span>
                        </th>
                        <td>
                          {index.index === null ? (
                            <span className="small muted">not enough yet</span>
                          ) : (
                            <Badge tone={indexTone(index.index)}>{index.index}</Badge>
                          )}
                        </td>
                        <td className="num">{rupees(route.medianMinor)}</td>
                        <td className="num">{route.carriers}</td>
                        <td className="num">{route.sampleSize.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <CardHead title="What AirIndex is not" />
            <p className="small">
              It is not a forecast. It knows nothing about fuel prices, airline capacity, festivals or
              school holidays, and it makes no claim about what a fare will do tomorrow. It reports what
              has been observed, with the working shown.
            </p>
            <p className="small">
              It is also not a survey of the market. It sees the fares this deployment’s connected sources
              returned for the searches its users ran — which is a real sample, and a partial one. The{' '}
              <Link href="/travel/airindex/quality">data quality page</Link> says exactly how partial.
            </p>
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}
