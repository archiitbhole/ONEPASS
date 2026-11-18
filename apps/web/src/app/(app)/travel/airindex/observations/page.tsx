/**
 * The observations themselves.
 *
 * Every other AirIndex page shows a conclusion. This one shows the rows those
 * conclusions are computed from, and offers the whole set as a CSV. It exists
 * because a published method that cannot be checked is not a method — it is a
 * claim with a footnote.
 *
 * The table is capped at a couple of hundred rows; the export is not. A page
 * that tried to render twenty thousand rows would be a page nobody could scroll
 * and a memory problem on a phone, and the export is the right tool for that
 * volume anyway.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  Stack,
  Stat,
  StatRow,
  TableScroll,
} from '@/components/ui';
import { RoutePicker } from '@/components/travel/airindex-ui';
import { cabinLabel, duration, rupees, stopsLabel } from '@/components/travel/format';
import { rankedRoutes, routeFigures } from '@/lib/travel/airindex';
import { listAirports } from '../../_queries';
import type { Cabin } from '@/lib/travel/providers/types';

export const metadata: Metadata = {
  title: 'Observations · AirIndex',
  description: 'The individual price observations every AirIndex figure is computed from.',
};

export const dynamic = 'force-dynamic';

const IATA = /^[A-Z]{3}$/;
const TABLE_LIMIT = 200;

/**
 * `db.execute` requires a row type it can index by string, because the driver
 * hands back a plain object. The index signature is that requirement, not a
 * suggestion that these rows have unknown fields.
 */
interface ObservationRow extends Record<string, unknown> {
  observed_at: string;
  depart_on: string;
  marketing_carrier: string;
  cabin: Cabin;
  stops: number;
  days_ahead: number;
  duration_minutes: number;
  price_minor: number;
  source: string;
}

export default async function ObservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; days?: string }>;
}) {
  const query = await searchParams;
  const origin = (query.from ?? '').trim().toUpperCase();
  const destination = (query.to ?? '').trim().toUpperCase();
  const days = Math.min(365, Math.max(1, Number(query.days ?? '90') || 90));

  const chosen = IATA.test(origin) && IATA.test(destination) && origin !== destination;
  const [airports, popular] = await Promise.all([listAirports(), rankedRoutes(10)]);

  const rows = chosen
    ? await db.execute<ObservationRow>(sql`
        select
          to_char(observed_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as observed_at,
          to_char(depart_on, 'YYYY-MM-DD') as depart_on,
          marketing_carrier, cabin::text as cabin, stops, days_ahead,
          duration_minutes, price_minor, source::text as source
        from flight_price_observations
        where origin_code = ${origin} and destination_code = ${destination}
          and observed_at >= now() - ${`${days} days`}::interval
        order by observed_at desc
        limit ${TABLE_LIMIT}
      `)
    : [];

  const figures = chosen ? await routeFigures({ origin, destination, windowDays: days }) : null;

  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap">
      <Stack gap={5}>

        <header className="stack stack-2">
          <p className="eyebrow">
            <Link href="/travel/airindex">AirIndex</Link> · Observations
          </p>
          <h1 className="h1">The observations themselves</h1>
          <p className="lede">
            Every figure AirIndex publishes is an aggregate over rows like these. They are here, and
            downloadable, so the working can be checked rather than taken on trust.
          </p>
        </header>

        <Card>
          <Stack gap={3}>
            <CardHead title="Choose a route" />
            <RoutePicker
              airports={airports}
              origin={origin}
              destination={destination}
              action="/travel/airindex/observations"
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
                    <Link
                      href={`/travel/airindex/observations?from=${route.originCode}&to=${route.destinationCode}`}
                    >
                      {route.originCode}–{route.destinationCode}
                    </Link>
                  </span>
                ))}
              </p>
            ) : null}
          </Stack>
        </Card>

        {!chosen ? (
          <Empty title="Pick a route" body="Observations are per route — enter two airport codes above." />
        ) : rows.length === 0 ? (
          <Empty
            title="Nothing observed"
            body={`No prices have been recorded on ${origin} to ${destination} in the last ${days} days.`}
          />
        ) : (
          <>
            <StatRow>
              <Stat
                label="In this window"
                value={(figures?.sampleSize ?? 0).toLocaleString('en-IN')}
                hint={`Showing the ${Math.min(rows.length, TABLE_LIMIT)} most recent`}
                tone="accent"
              />
              <Stat label="Median" value={figures?.medianMinor ? rupees(figures.medianMinor) : '—'} />
              <Stat label="Lowest" value={figures?.minMinor ? rupees(figures.minMinor) : '—'} tone="ok" />
              <Stat label="Highest" value={figures?.maxMinor ? rupees(figures.maxMinor) : '—'} tone="warn" />
            </StatRow>

            <Card>
              <Stack gap={3}>
                <CardHead
                  title={`${origin} → ${destination}`}
                  action={
                    // A plain link to the export endpoint. It sets its own
                    // content-disposition, so the browser downloads rather than
                    // navigates — no JavaScript involved.
                    <a
                      className="btn"
                      href={`/api/travel/airindex/export?from=${origin}&to=${destination}&days=${days}`}
                    >
                      Download CSV
                    </a>
                  }
                />
                <TableScroll>
                  <table className="table">
                    <caption className="sr-only">
                      The most recent price observations on this route, newest first
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Observed</th>
                        <th scope="col">Departs</th>
                        <th scope="col">Airline</th>
                        <th scope="col">Cabin</th>
                        <th scope="col">Stops</th>
                        <th scope="col" className="num">
                          Days ahead
                        </th>
                        <th scope="col" className="num">
                          Journey
                        </th>
                        <th scope="col" className="num">
                          Price
                        </th>
                        <th scope="col">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={`${row.observed_at}-${row.marketing_carrier}-${index}`}>
                          <th scope="row" className="tiny">
                            {row.observed_at}
                          </th>
                          <td className="tiny">{row.depart_on}</td>
                          <td>{row.marketing_carrier}</td>
                          <td className="tiny">{cabinLabel(row.cabin)}</td>
                          <td className="tiny">{stopsLabel(row.stops)}</td>
                          <td className="num">{row.days_ahead}</td>
                          <td className="num tiny">{duration(row.duration_minutes)}</td>
                          <td className="num">{rupees(row.price_minor)}</td>
                          <td>
                            <Badge tone={row.source === 'SAMPLE' ? 'warn' : 'neutral'}>{row.source}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>

                <p className="tiny muted">
                  One row per fare seen, per passenger, at the moment somebody searched. Nothing here
                  identifies a person — a route, a date, an airline and a price is the whole of it. Rows
                  marked <code>SAMPLE</code> came from the development source and are fixtures, not
                  airline fares.
                </p>
              </Stack>
            </Card>
          </>
        )}

        <Card>
          <Stack gap={3}>
            <CardHead title="What is in the export" />
            <p className="small">
              The CSV carries every observation in the window, up to twenty thousand rows: when it was
              seen, the departure date, the airline, cabin, stops, how far ahead the search was, the
              journey time, the price in rupees, and which source quoted it.
            </p>
            <p className="small muted">
              <Link href="/travel/airindex/methodology">The methodology page</Link> explains how the
              medians and the index are computed from exactly these columns.
            </p>
          </Stack>
        </Card>
      </Stack>
    </div>
  );
}
