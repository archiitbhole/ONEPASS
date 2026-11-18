/**
 * The route, drawn.
 *
 * Two airports and the line between them, projected from the latitude and
 * longitude already in the `airports` table. It is deliberately *not* a map:
 * there are no tiles, no coastline, no imagery and no request to anybody —
 * which is the point. A map tile would be a third party watching every person
 * who opens a trip, and a stock photograph of a city would imply a place looks
 * like something we have not photographed.
 *
 * What it is instead is a diagram of a distance, and the distance is real: the
 * great-circle length between the two coordinates, stated in words beside it.
 * The drawing is `aria-hidden` because the sentence under it carries everything
 * the picture does.
 *
 * Renders nothing at all when either airport has no coordinates. A route arc
 * between two guessed points would be a drawing of a guess.
 */
import type { CSSProperties } from 'react';

export interface ArcPlace {
  code: string;
  city?: string | null;
  latitude?: string | null;
  longitude?: string | null;
}

/**
 * Great-circle distance in kilometres.
 *
 * Floating point is correct here and nowhere near money: this is a physical
 * quantity rounded to the nearest ten kilometres for display, not an amount
 * anybody is charged.
 */
export function greatCircleKm(from: ArcPlace, to: ArcPlace): number | null {
  const a = coords(from);
  const b = coords(to);
  if (!a || !b) return null;

  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function coords(place: ArcPlace): { lat: number; lon: number } | null {
  const lat = Number(place.latitude);
  const lon = Number(place.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (place.latitude === null || place.longitude === null) return null;
  return { lat, lon };
}

export function RouteArc({
  from,
  to,
  className,
  style,
}: {
  from: ArcPlace;
  to: ArcPlace;
  className?: string;
  style?: CSSProperties;
}) {
  const a = coords(from);
  const b = coords(to);
  if (!a || !b) return null;

  // Equirectangular, with longitude squeezed by the cosine of the mean latitude
  // so an east–west leg is not stretched relative to a north–south one. Over a
  // single flight this is close enough that the line has the right slope, and
  // the drawing claims nothing more than that.
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const px = (p: { lat: number; lon: number }) => ({ x: p.lon * Math.cos(meanLat), y: -p.lat });
  const p1 = px(a);
  const p2 = px(b);

  const spanX = Math.abs(p2.x - p1.x);
  const spanY = Math.abs(p2.y - p1.y);

  /*
    The box takes the route's own shape.

    A fixed landscape viewBox drew Delhi–Mumbai — a route that is almost due
    south — as a thin vertical line in the middle of a wide empty card, which
    reads as a broken drawing rather than as a bearing. So the longest side is
    fixed and the other follows the span, clamped at both ends: a perfectly
    north–south route would otherwise become a sliver one pixel wide, and a
    perfectly east–west one a strip with no room for the arc's lift.
  */
  const LONG = 200;
  const ratio = spanY / Math.max(spanX, 0.0001);
  const width = ratio > 1 ? clamp(LONG / ratio, 110, LONG) : LONG;
  const height = ratio > 1 ? LONG * 0.85 : clamp(LONG * ratio, 84, LONG * 0.85);
  const pad = 26;

  // Fit the two points into the box, keeping the aspect ratio of the projection
  // so the arc is not sheared.
  const scale = Math.min(
    (width - pad * 2) / Math.max(spanX, 0.0001),
    (height - pad * 2) / Math.max(spanY, 0.0001),
  );
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const at = (p: { x: number; y: number }) => ({
    x: width / 2 + (p.x - midX) * scale,
    y: height / 2 + (p.y - midY) * scale,
  });
  const s = at(p1);
  const e = at(p2);

  // The control point lifts the line off its chord by a fifth of its length,
  // perpendicular to it — the shape a flight path is drawn as, and the reason
  // the two ends do not sit on a ruler.
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const length = Math.hypot(dx, dy) || 1;
  const lift = Math.min(30, length * 0.22);
  const cx = (s.x + e.x) / 2 - (dy / length) * lift;
  const cy = (s.y + e.y) / 2 + (dx / length) * lift;

  const km = greatCircleKm(from, to);
  const fromName = from.city ?? from.code;
  const toName = to.city ?? to.code;

  return (
    <figure className={className ? `stack stack-2 ${className}` : 'stack stack-2'} style={style}>
      <svg
        className="route-arc"
        viewBox={`0 0 ${width} ${height}`}
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        <path className="route-arc-ghost" d={`M${s.x.toFixed(1)},${s.y.toFixed(1)} L${e.x.toFixed(1)},${e.y.toFixed(1)}`} />
        <path
          className="route-arc-path"
          d={`M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)}`}
        />
        <circle className="route-arc-node" cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r="3.6" />
        <circle className="route-arc-node" cx={e.x.toFixed(1)} cy={e.y.toFixed(1)} r="3.6" />
        {/* Each label sits on the far side of its own node, so neither lands on
            the line between them however the route is oriented. */}
        <text
          className="route-arc-label"
          x={s.x.toFixed(1)}
          y={(s.y + (s.y <= e.y ? -8 : 15)).toFixed(1)}
          textAnchor="middle"
        >
          {from.code}
        </text>
        <text
          className="route-arc-label"
          x={e.x.toFixed(1)}
          y={(e.y + (e.y < s.y ? -8 : 15)).toFixed(1)}
          textAnchor="middle"
        >
          {to.code}
        </text>
      </svg>
      <figcaption className="tiny muted">
        {fromName} to {toName}
        {km !== null ? ` · about ${km.toLocaleString('en-IN')} km in a straight line` : ''}. Drawn from the
        airports’ own coordinates — not a map, and not the route the aircraft flies.
      </figcaption>
    </figure>
  );
}
