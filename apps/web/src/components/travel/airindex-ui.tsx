/**
 * The pieces every AirIndex page shares.
 *
 * Five of them: a route picker, the index drawn on its own scale, a price
 * chart, a row of bars, and the sample-size note that goes under every figure.
 * The last is the important one — it is a single component precisely so that no
 * page can publish a number without it, and so the wording of "how much data is
 * this" is identical everywhere.
 *
 * Every drawing here obeys the same two rules. It is inline SVG rendered on the
 * server, so the picture is in the HTML the first time it is painted and no
 * charting library is shipped to a phone; and it has a text equivalent that
 * carries the same numbers, because a chart a person cannot check is a claim
 * with a footnote rather than a method.
 */
import Link from 'next/link';
import type { AirportOption } from '@/app/(app)/travel/_queries';
import type { PricePoint } from '@/lib/travel/airindex';
import { indexTone, rupees } from './format';

/**
 * Pick a route.
 *
 * A GET form, like the flight search, so every view of AirIndex has a URL. The
 * airports are the ones ONEPASS has data for; the picker does not offer a route
 * the index has never seen, because an empty state reached from a dropdown reads
 * as a fault rather than as an absence.
 */
export function RoutePicker({
  airports,
  origin,
  destination,
  action,
  extra,
}: {
  airports: AirportOption[];
  origin: string;
  destination: string;
  action: string;
  /** Extra controls — a window selector, a cabin — rendered inside the same form. */
  extra?: React.ReactNode;
}) {
  return (
    <form method="get" action={action} className="op-route-picker">
      <datalist id="op-index-airports">
        {airports.map((airport) => (
          <option key={airport.code} value={airport.code} label={`${airport.city} — ${airport.name}`} />
        ))}
      </datalist>

      <label className="op-picker-field">
        <span className="label">From</span>
        <input
          name="from"
          list="op-index-airports"
          className="input"
          defaultValue={origin}
          placeholder="DEL"
          maxLength={3}
          style={{ textTransform: 'uppercase' }}
          autoComplete="off"
          required
        />
      </label>

      <label className="op-picker-field">
        <span className="label">To</span>
        <input
          name="to"
          list="op-index-airports"
          className="input"
          defaultValue={destination}
          placeholder="BOM"
          maxLength={3}
          style={{ textTransform: 'uppercase' }}
          autoComplete="off"
          required
        />
      </label>

      {extra}

      <button type="submit" className="btn btn-primary">
        Show
      </button>
    </form>
  );
}

/**
 * The sample-size note.
 *
 * Under every figure AirIndex publishes, without exception. A median over 2,400
 * observations and a median over 13 are different kinds of claim, and a reader
 * who is not told which one they are looking at has been misled by omission.
 */
export function SampleNote({
  sampleSize,
  minimum,
  from,
  to,
}: {
  sampleSize: number;
  minimum: number;
  from?: Date | null;
  to?: Date | null;
}) {
  if (sampleSize < minimum) {
    return (
      <p className="tiny muted">
        {sampleSize.toLocaleString('en-IN')} observation{sampleSize === 1 ? '' : 's'} — fewer than the{' '}
        {minimum} needed before a figure is published. Nothing is shown rather than a number this thin.
      </p>
    );
  }
  return (
    <p className="tiny muted">
      From {sampleSize.toLocaleString('en-IN')} observed price{sampleSize === 1 ? '' : 's'}
      {from && to ? `, between ${from.toLocaleDateString('en-IN')} and ${to.toLocaleDateString('en-IN')}` : ''}.{' '}
      <Link href="/travel/airindex/methodology">How this is computed</Link>.
    </p>
  );
}

/**
 * How thin a sample is, said in words rather than as a confidence percentage.
 *
 * There is no ground truth to measure AirIndex against, so a "94% confident"
 * would have to be invented. What can be said honestly is how many rows a
 * figure rests on and what that does to it, so that is what is said.
 */
export function uncertaintyNote(sampleSize: number, minimum: number): string | null {
  if (sampleSize < minimum) return null;
  if (sampleSize < minimum * 3) {
    return `This rests on ${sampleSize.toLocaleString('en-IN')} observations — just past the threshold. A single unusual fare moves a median this small, so treat it as a direction rather than a figure.`;
  }
  if (sampleSize < minimum * 10) {
    return `${sampleSize.toLocaleString('en-IN')} observations: enough for the middle of the distribution, thin at its edges.`;
  }
  return null;
}

/**
 * The index, on the scale it means something against.
 *
 * A bare "118" is unreadable — 118 of what? The scale draws 100 as a marked
 * line with the ordinary band around it, so the figure is read against
 * something rather than believed. The numbers are all in the caption too.
 */
export function IndexScale({ index, label }: { index: number; label: string }) {
  // 50 to 200 covers everything a fare index realistically reaches; beyond that
  // the mark pins to the end and the figure beside it still says the truth.
  const LOW = 50;
  const HIGH = 200;
  const width = 200;
  const height = 34;
  const at = (value: number) => ((Math.min(HIGH, Math.max(LOW, value)) - LOW) / (HIGH - LOW)) * width;
  const ticks = [50, 75, 100, 125, 150, 175, 200];

  return (
    <div className={`stat-${indexTone(index) === 'neutral' ? 'neutral' : indexTone(index)}`} style={{ padding: 0 }}>
      <svg
        className="op-index-scale"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}. ${index} on a scale where 100 is the usual fare; 90 to 110 is ordinary.`}
      >
        <rect className="op-index-track" x="0" y="10" width={width} height="8" rx="4" />
        {/* The ordinary band: 90–110, where the index says nothing has moved. */}
        <rect className="op-index-band" x={at(90)} y="10" width={at(110) - at(90)} height="8" rx="4" />
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="op-index-tick" x1={at(tick)} y1="6" x2={at(tick)} y2="22" />
            <text className="op-index-tick-label" x={at(tick)} y="31" textAnchor="middle">
              {tick}
            </text>
          </g>
        ))}
        <line className="op-index-mark" x1={at(index)} y1="3" x2={at(index)} y2="25" />
      </svg>
    </div>
  );
}

/**
 * A price chart, drawn as an SVG on the server.
 *
 * No charting library. The page has no JavaScript at all, the chart is in the
 * HTML the first time it is painted, and the whole thing is about a hundred
 * lines — a dependency for this would cost more in bundle size than the feature
 * is worth, and would not render without hydration.
 *
 * `preserveAspectRatio="none"` with a viewBox means it scales to whatever width
 * it is given without a media query, which is what makes it work at 320px. The
 * dots are drawn at their own scale afterwards so they are not stretched into
 * ellipses by it.
 *
 * Days with no observations are **absent**, never interpolated: a straight line
 * drawn across a gap looks like knowledge and is the opposite of it.
 */
export function PriceChart({
  points,
  label,
  /** Show the numbers themselves under the chart. On by default. */
  numbers = true,
}: {
  points: PricePoint[];
  label: string;
  numbers?: boolean;
}) {
  if (points.length < 2) {
    return (
      <p className="small muted">
        A chart needs at least two days of observations. There {points.length === 1 ? 'is' : 'are'}{' '}
        {points.length}.
      </p>
    );
  }

  const width = 100;
  const height = 40;
  const values = points.map((point) => point.medianMinor);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A flat series would divide by zero and, worse, would draw a line through the
  // middle that looks like variation. A one-rupee floor keeps it flat and honest.
  const span = Math.max(1, high - low);

  const x = (index: number) => (index / (points.length - 1)) * width;
  const y = (value: number) => height - ((value - low) / span) * (height - 4) - 2;

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.medianMinor).toFixed(2)}`)
    .join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const change =
    first.medianMinor === 0 ? 0 : Math.round(((last.medianMinor - first.medianMinor) / first.medianMinor) * 100);

  return (
    <figure className="op-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}. ${points.length} days with observations, from ${rupees(first.medianMinor)} to ${rupees(
          last.medianMinor,
        )}, ${change === 0 ? 'unchanged' : `${Math.abs(change)}% ${change > 0 ? 'higher' : 'lower'}`}. Lowest ${rupees(
          low,
        )}, highest ${rupees(high)}.`}
      >
        {/* Three horizontal rules: the low, the middle and the high. They are
            what turns a squiggle into a reading. */}
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            className="op-chart-grid"
            x1="0"
            x2={width}
            y1={y(low + span * fraction)}
            y2={y(low + span * fraction)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} className="op-chart-area" />
        <path d={line} className="op-chart-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="op-chart-caption">
        <span>{rupees(low)}</span>
        <span className="muted">
          {points.length} day{points.length === 1 ? '' : 's'} with observations ·{' '}
          {change === 0 ? 'unchanged' : `${Math.abs(change)}% ${change > 0 ? 'higher' : 'lower'} than at the start`}
        </span>
        <span>{rupees(high)}</span>
      </figcaption>

      {numbers ? (
        <details className="disclose" style={{ marginBlockStart: 'var(--s-3)' }}>
          <summary>Show the numbers this is drawn from</summary>
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">{label}, day by day</caption>
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
                {points.map((point) => (
                  <tr key={point.day}>
                    <th scope="row">{point.day}</th>
                    <td className="num">{rupees(point.medianMinor)}</td>
                    <td className="num">{rupees(point.minMinor)}</td>
                    <td className="num">{point.sampleSize.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}

export interface BarRow {
  label: string;
  /** Null where the sample was too thin to publish a figure. */
  valueMinor: number | null;
  sampleSize: number;
  /** Rendered instead of the amount when there is no figure. */
  note?: string;
}

/**
 * A row of bars over amounts that share a scale.
 *
 * Every bar carries its own number, and a row with no publishable figure is
 * drawn as a hatched stub with the reason rather than as a bar of zero — a
 * zero-length bar reads as "cheap", which is the opposite of "unknown".
 */
export function BarRows({ rows, label, minimum }: { rows: BarRow[]; label: string; minimum: number }) {
  const amounts = rows.map((row) => row.valueMinor).filter((value): value is number => value !== null);
  const max = amounts.length > 0 ? Math.max(...amounts) : 0;

  return (
    <div className="op-bars" role="group" aria-label={label}>
      {rows.map((row) => {
        const thin = row.valueMinor === null;
        const width = thin || max === 0 ? 14 : Math.max(4, (row.valueMinor! / max) * 100);
        return (
          <div className="op-bar-row" key={row.label}>
            <span className="op-bar-label">{row.label}</span>
            <span className="op-bar">
              <span className="op-bar-fill" data-thin={thin ? 'true' : undefined} style={{ width: `${width}%` }} />
            </span>
            <span className="op-bar-figure">
              {thin ? (
                <span className="muted">
                  {row.note ?? `${row.sampleSize} of ${minimum} needed`}
                </span>
              ) : (
                <>
                  {rupees(row.valueMinor!)}{' '}
                  <span className="muted tiny">n={row.sampleSize.toLocaleString('en-IN')}</span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
