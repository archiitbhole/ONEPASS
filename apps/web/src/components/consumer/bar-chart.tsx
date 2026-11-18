/**
 * A bar chart as inline SVG. No library, no client JavaScript.
 *
 * It draws exactly the rows it is given: no smoothing, no projected months, no
 * "typical" bar to fill a gap. A month with nothing in it is drawn as an empty slot,
 * which is the honest picture of a month with nothing in it.
 *
 * The chart is a picture of numbers that are also printed in a table beside it, so
 * `role="img"` with a summary label is the right accessibility contract — the
 * underlying figures are readable without it.
 */
export interface BarDatum {
  label: string;
  /** Minor units, or any non-negative integer. Only used for the bar's height. */
  value: number;
  /** The same figure, already formatted for a human. */
  valueLabel: string;
}

const W = 760;
const H = 280;
const PAD_L = 78;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 46;

/** A round-ish top for the axis: 1, 2 or 5 × a power of ten above the tallest bar. */
function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= max) return candidate;
  }
  return 10 * magnitude;
}

export function BarChart({
  data,
  title,
  axisLabel,
  formatTick,
}: {
  data: BarDatum[];
  /** Announced to a screen reader, and used as the SVG's title. */
  title: string;
  /** What the vertical axis measures, e.g. "Saved (₹)". */
  axisLabel: string;
  /** Formats a y-axis tick. Server-side only; both sides of this call render on the server. */
  formatTick: (value: number) => string;
}) {
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const top = niceCeiling(Math.max(...data.map((d) => d.value), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);

  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(56, Math.max(8, slot * 0.58));
  // Past a dozen columns the labels collide, so every other one is dropped.
  const labelEvery = data.length > 12 ? 2 : 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={title}
      style={{ display: 'block', height: 'auto', maxWidth: '100%' }}
    >
      <title>{title}</title>

      {/* Horizontal gridlines, each labelled — a chart with an unlabelled axis is a shape, not a measurement. */}
      {ticks.map((t, i) => {
        const y = PAD_T + plotH - (t / top) * plotH;
        return (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y}
              y2={y}
              stroke="var(--line)"
              strokeWidth={i === 0 ? 1.5 : 1}
              strokeDasharray={i === 0 ? undefined : '3 4'}
            />
            <text
              x={PAD_L - 10}
              y={y + 4}
              textAnchor="end"
              fill="var(--muted)"
              fontSize="11"
              fontFamily="var(--mono)"
            >
              {formatTick(t)}
            </text>
          </g>
        );
      })}

      <text
        transform={`translate(16 ${PAD_T + plotH / 2}) rotate(-90)`}
        textAnchor="middle"
        fill="var(--muted)"
        fontSize="11"
        fontWeight="600"
        letterSpacing="0.08em"
      >
        {axisLabel.toUpperCase()}
      </text>

      {data.map((d, i) => {
        const h = top > 0 ? (d.value / top) * plotH : 0;
        const x = PAD_L + slot * i + (slot - barW) / 2;
        const y = PAD_T + plotH - h;
        return (
          <g key={d.label}>
            {d.value > 0 ? (
              <rect x={x} y={y} width={barW} height={Math.max(h, 2)} rx="3" fill="var(--accent)" />
            ) : (
              // An empty slot, drawn as a hairline on the baseline so the gap reads
              // as "nothing happened" rather than as a missing column.
              <rect x={x} y={PAD_T + plotH - 1} width={barW} height="1" fill="var(--line-2)" />
            )}
            {d.value > 0 ? (
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                fill="var(--ink-2)"
                fontSize="10.5"
                fontFamily="var(--mono)"
              >
                {d.valueLabel}
              </text>
            ) : null}
            {i % labelEvery === 0 ? (
              <text
                x={x + barW / 2}
                y={H - PAD_B + 20}
                textAnchor="middle"
                fill="var(--muted)"
                fontSize="11"
              >
                {d.label}
              </text>
            ) : null}
          </g>
        );
      })}

      <line
        x1={PAD_L}
        x2={PAD_L}
        y1={PAD_T}
        y2={PAD_T + plotH}
        stroke="var(--line-2)"
        strokeWidth="1.5"
      />
    </svg>
  );
}
