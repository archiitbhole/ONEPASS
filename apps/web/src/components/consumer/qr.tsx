/**
 * QR rendering.
 *
 * Imported from `@onepass/pass/qr`, the encoder's own entry point, rather than
 * from the package root. The root re-exports the TOTP code alongside it, and
 * that imports `node:crypto` — so importing the root from anything that reaches
 * a client bundle fails the build with a module resolution error that names
 * `node:crypto` and not the actual mistake. The subpath has no such dependency:
 * it is plain arithmetic over a string.
 *
 * That matters now because one screen genuinely needs to encode in the browser.
 * `/offline` draws the codes for tickets kept on the device, with no server to
 * ask — which is the entire reason it works at a door with no signal. Everywhere
 * else still encodes on the server and sends a picture.
 *
 * Two shapes are produced from one matrix:
 *   · `QrSvg`  — inline SVG, for anything that never changes (a ticket).
 *   · `qrRows` — the same matrix as '0'/'1' strings, small enough to hand to a client
 *                component that draws it to a canvas (the rotating pass).
 */
import { encode as encodeQr } from '@onepass/pass/qr';

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

function matrix(text: string, level: QrLevel): boolean[][] {
  return encodeQr(text, level) as boolean[][];
}

/** The matrix as row strings — a compact, serialisable prop for a client component. */
export function qrRows(text: string, level: QrLevel = 'M'): string[] {
  return matrix(text, level).map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
}

/**
 * A QR as inline SVG at maximum contrast.
 *
 * Pure black on pure white, never a theme colour: a scanner reads luminance, and a
 * code drawn in the palette's ink on the palette's surface is a code that fails in
 * dark mode at a cinema door. The four-module quiet zone is part of the spec, not
 * padding — without it the finder patterns are ambiguous.
 */
export function QrSvg({
  text,
  level = 'M',
  size = 260,
  title,
}: {
  text: string;
  level?: QrLevel;
  size?: number;
  title: string;
}) {
  const rows = matrix(text, level);
  const modules = rows.length;
  const quiet = 4;
  const span = modules + quiet * 2;

  // One path for the whole code: thousands of <rect> elements is a slow paint and a
  // large document, and the geometry is identical.
  let d = '';
  for (let y = 0; y < modules; y++) {
    const row = rows[y];
    if (!row) continue;
    for (let x = 0; x < modules; x++) {
      if (row[x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      role="img"
      aria-label={title}
      shapeRendering="crispEdges"
      style={{ display: 'block' }}
    >
      <title>{title}</title>
      <rect width={span} height={span} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
