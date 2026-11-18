/**
 * The console's drawings, all server-rendered SVG.
 *
 * No chart library: these are a polyline and a few rectangles, and shipping a
 * runtime to a partner's laptop to draw fourteen points would be the wrong trade
 * for a console that is otherwise entirely server-rendered. Colours come from the
 * theme variables, so both work in light and dark without a second palette.
 *
 * Neither component interpolates, smooths or extrapolates. A gap in the data is a
 * zero, because it is one — a day with no captured payment took no money.
 *
 * Every drawing here obeys the rule the rest of the product does: a picture is
 * only allowed to say something a person can check. So a chart carries its own
 * scale as drawn rules with the figures on them, and the numbers it was drawn
 * from are one disclosure away. A chart nobody can read back is decoration, and
 * an operations screen has no room for it.
 */
import { formatMoney } from '@/components/ui';

export interface SeriesPoint {
  /** 'YYYY-MM-DD' — the bucket, so the caller can match it back to a row. */
  key: string;
  label: string;
  value: number;
}

/**
 * A revenue line over days.
 *
 * Scaled from zero rather than from the minimum: a line that starts at the lowest
 * day makes a flat fortnight look like a cliff, which is a lie told by a chart
 * axis rather than by anyone in particular.
 */
export function Sparkline({
  series,
  currency = 'INR',
  height = 92,
  ariaLabel,
  /** The day-by-day table under the chart. On by default. */
  numbers = true,
}: {
  series: SeriesPoint[];
  currency?: string;
  height?: number;
  ariaLabel: string;
  numbers?: boolean;
}) {
  if (series.length === 0) return null;

  const width = 100; // a viewBox unit grid; the SVG itself is width:100%
  const max = Math.max(...series.map((p) => p.value), 1);
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  const y = (value: number) => height - (value / max) * (height - 8) - 4;

  const points = series.map((point, i) => [i * step, y(point.value)] as const);
  const line = points.map(([x, py]) => `${x.toFixed(2)},${py.toFixed(2)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const last = points[points.length - 1]!;
  const peak = series.reduce((best, p) => (p.value > best.value ? p : best), series[0]!);
  const total = series.reduce((sum, p) => sum + p.value, 0);

  return (
    <figure className="chart">
      <div className="chart-plot">
        {/* The scale, as text beside the rules rather than inside the SVG: the
            viewBox is stretched to the card's width, and text inside it would be
            stretched with it. */}
        <div className="chart-scale" aria-hidden="true">
          <span>{formatMoney(max, currency)}</span>
          <span>{formatMoney(Math.round(max / 2), currency)}</span>
          <span>{formatMoney(0, currency)}</span>
        </div>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${ariaLabel}. Highest day ${peak.label} at ${formatMoney(peak.value, currency)}. ${formatMoney(
            total,
            currency,
          )} over ${series.length} day${series.length === 1 ? '' : 's'}.`}
          className="chart-svg"
          style={{ height }}
        >
          {[0, 0.5, 1].map((fraction) => (
            <line
              key={fraction}
              className="chart-rule"
              x1="0"
              x2={width}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polygon points={area} className="chart-area" />
          <polyline points={line} className="chart-line" vectorEffect="non-scaling-stroke" />
          <circle cx={last[0]} cy={last[1]} r="2.5" className="chart-point" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      <figcaption className="chart-caption">
        <span>{series[0]!.label}</span>
        <span className="muted">
          peak {formatMoney(peak.value, currency)} on {peak.label}
        </span>
        <span>{series[series.length - 1]!.label}</span>
      </figcaption>

      {numbers ? (
        <details className="disclose">
          <summary>Show the numbers this is drawn from</summary>
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">{ariaLabel}, day by day</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className="table-num">
                    Taken
                  </th>
                </tr>
              </thead>
              <tbody>
                {series.map((point) => (
                  <tr key={point.key}>
                    <th scope="row">{point.label}</th>
                    <td className="table-num">{formatMoney(point.value, currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="table-num">{formatMoney(total, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}

/**
 * Capacity for one slot: sold, held, and what is left.
 *
 * Three segments rather than one percentage because the three numbers mean
 * different things to whoever is looking — sold is money, held is a checkout in
 * flight that may yet lapse, and available is what can still be sold today.
 */
export function CapacityBar({ capacity, held, sold }: { capacity: number; held: number; sold: number }) {
  const total = Math.max(capacity, held + sold, 1);
  const pct = (n: number) => `${((n / total) * 100).toFixed(2)}%`;
  const available = Math.max(0, capacity - held - sold);

  return (
    <div
      className="capacity-bar"
      role="img"
      aria-label={`${sold} sold, ${held} held, ${available} available of ${capacity}`}
    >
      <span className="capacity-sold" style={{ width: pct(sold) }} />
      <span className="capacity-held" style={{ width: pct(held) }} />
    </div>
  );
}

/** The legend for the bar above, printed once per page rather than per row. */
export function CapacityLegend() {
  return (
    <p className="tiny muted row-wrap capacity-legend">
      <span>
        <i className="capacity-swatch capacity-sold" aria-hidden="true" /> sold
      </span>
      <span>
        <i className="capacity-swatch capacity-held" aria-hidden="true" /> held in checkout
      </span>
      <span>
        <i className="capacity-swatch" aria-hidden="true" /> still available
      </span>
    </p>
  );
}
