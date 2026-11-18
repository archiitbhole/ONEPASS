/**
 * Historical analytics.
 *
 * Four windows — a week, a month, a quarter, a year — over the same route, so a
 * short spike can be told from a long trend. The chart and the table say the
 * same thing twice on purpose: a chart is faster to read and a table is the one
 * a person can check.
 *
 * Days with no searches are *absent* rather than interpolated. A straight line
 * drawn across a gap looks like knowledge and is the opposite of it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
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
import { rupees } from '@/components/travel/format';
import { MIN_SAMPLE, fareIndex, priceHistory, rankedRoutes, routeFigures } from '@/lib/travel/airindex';
import { listAirports } from '../../_queries';

export const metadata: Metadata = {
  title: 'Price history · AirIndex',
  description: 'How a route’s fares have moved over a week, a month, a quarter or a year.',
};

export const dynamic = 'force-dynamic';

const IATA = /^[A-Z]{3}$/;
const WINDOWS = [7, 30, 90, 365] as const;
type Window = (typeof WINDOWS)[number];

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; days?: string }>;
}) {
  const query = await searchParams;
  const origin = (query.from ?? '').trim().toUpperCase();
  const destination = (query.to ?? '').trim().toUpperCase();
  const days: Window = WINDOWS.find((value) => String(value) === query.days) ?? 90;

  const chosen = IATA.test(origin) && IATA.test(destination) && origin !== destination;
  const [airports, popular] = await Promise.all([listAirports(), rankedRoutes(10)]);

  const [history, figures, index] = chosen
    ? await Promise.all([
        priceHistory({ origin, destination, days }),
        routeFigures({ origin, destination, windowDays: days }),
        fareIndex({ origin, destination }),
      ])
    : [[], null, null];

  const totalObservations = history.reduce((sum, point) => sum + point.sampleSize, 0);

  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap">
      <Stack gap={5}>

        <header className="stack stack-2">
          <p className="eyebrow">
            <Link href="/travel/airindex">AirIndex</Link> · History
          </p>
          <h1 className="h1">Price history</h1>
          <p className="lede">
            How a route’s fares have moved, day by day, over the window you choose. Every point is the
            median of what was observed that day.
          </p>
        </header>

        <Card>
          <Stack gap={3}>
            <CardHead title="Choose a route and a window" />
            <RoutePicker
              airports={airports}
              origin={origin}
              destination={destination}
              action="/travel/airindex/history"
              extra={
                <label className="op-picker-field">
                  <span className="label">Window</span>
                  <select name="days" className="input" defaultValue={String(days)}>
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
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
                    <Link href={`/travel/airindex/history?from=${route.originCode}&to=${route.destinationCode}`}>
                      {route.originCode}–{route.destinationCode}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </Stack>
        </Card>

        {!chosen ? (
          <Empty title="Pick a route" body="History is per route — enter two airport codes above." />
        ) : history.length === 0 ? (
          <Empty
            title="No observations in this window"
            body={`Nothing has been observed on ${origin} to ${destination} in the last ${days} days. A longer window may have something.`}
            action={<ButtonLink href={`/travel/airindex/history?from=${origin}&to=${destination}&days=365`}>Try a year</ButtonLink>}
          />
        ) : (
          <>
            <Card>
              <Stack gap={4}>
                <CardHead title={`${origin} → ${destination}, last ${days} days`} />
                <PriceChart points={history} label={`Median fare, ${origin} to ${destination}, last ${days} days`} />
                <StatRow>
                  <Stat
                    label="Days with data"
                    value={history.length}
                    hint={`Out of ${days}. Days with no searches are absent, not filled in.`}
                  />
                  <Stat
                    label="Lowest observed"
                    value={figures?.minMinor ? rupees(figures.minMinor) : '—'}
                    tone="ok"
                  />
                  <Stat label="Highest observed" value={figures?.maxMinor ? rupees(figures.maxMinor) : '—'} tone="warn" />
                  <Stat
                    label="Fare index now"
                    value={index?.index ?? '—'}
                    hint={index?.index === null ? 'Not enough recent data' : index?.verdict}
                  />
                </StatRow>
                <SampleNote
                  sampleSize={figures?.sampleSize ?? 0}
                  minimum={MIN_SAMPLE}
                  from={figures?.observedFrom}
                  to={figures?.observedTo}
                />
              </Stack>
            </Card>

            <Card>
              <Stack gap={3}>
                <CardHead
                  title="Day by day"
                  action={
                    <ButtonLink
                      href={`/travel/airindex/observations?from=${origin}&to=${destination}&days=${days}`}
                      variant="ghost"
                    >
                      The raw observations
                    </ButtonLink>
                  }
                />
                <TableScroll>
                  <table className="table">
                    <caption className="sr-only">
                      Median and lowest fare observed on each day, most recent first
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        <th scope="col" className="num">
                          Median
                        </th>
                        <th scope="col" className="num">
                          Lowest
                        </th>
                        <th scope="col" className="num">
                          Observations
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...history].reverse().map((point) => (
                        <tr key={point.day}>
                          <th scope="row">{point.day}</th>
                          <td className="num">{rupees(point.medianMinor)}</td>
                          <td className="num">{rupees(point.minMinor)}</td>
                          <td className="num">{point.sampleSize.toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
                <p className="tiny muted">
                  {totalObservations.toLocaleString('en-IN')} observations across {history.length} day
                  {history.length === 1 ? '' : 's'}. A day’s median is over however many fares were seen
                  that day — a day with three is not the same evidence as a day with three hundred, and
                  the count is there so you can tell.
                </p>
              </Stack>
            </Card>
          </>
        )}
      </Stack>
    </div>
  );
}
