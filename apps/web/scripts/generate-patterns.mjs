/**
 * Generate the engraved line patterns printed on ONEPASS objects.
 *
 * Guilloche — the interlaced line-work on passports and banknotes — is made by
 * a machine tracing one curve many times at small offsets. These are the same
 * curves, computed: hypotrochoids for the rosette, summed sines for the bands
 * and the field. They are written once to public/patterns as static SVG, used
 * as CSS masks (so the colour comes from the theme, not the file), cached by
 * the browser, and add nothing to any page's HTML.
 *
 * Run: node scripts/generate-patterns.mjs — the output is committed.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'patterns');
await mkdir(out, { recursive: true });

const f = (n) => (Math.round(n * 10) / 10).toString();

function pathFrom(points) {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + 'Z';
}

/** A rosette: one hypotrochoid traced at many rotations. */
function rosette({ size = 400, R = 120, r = 45, d = 82, copies = 14, steps = 540, loops = 3 }) {
  const c = size / 2;
  const paths = [];
  for (let k = 0; k < copies; k++) {
    const rot = (k / copies) * ((2 * Math.PI) / (R / gcd(R, r)));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * 2 * Math.PI * loops;
      const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
      const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
      const s = (size / 2 - 4) / (R - r + d);
      pts.push([c + s * (x * Math.cos(rot) - y * Math.sin(rot)), c + s * (x * Math.sin(rot) + y * Math.cos(rot))]);
    }
    paths.push(pathFrom(pts));
  }
  return svg(size, size, paths, 0.55);
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

/** A band: interfering sine waves, tileable left to right. */
function band({ w = 480, h = 96, lines = 22 }) {
  const paths = [];
  for (let k = 0; k < lines; k++) {
    const phase = (k / lines) * Math.PI * 2;
    const pts = [];
    for (let x = 0; x <= w; x += 3) {
      const u = (x / w) * Math.PI * 2;
      const y = h / 2 + (h * 0.3) * Math.sin(u * 2 + phase) + (h * 0.14) * Math.sin(u * 5 - phase * 2);
      pts.push([x, y]);
    }
    paths.push(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(''));
  }
  return svg(w, h, paths, 0.6);
}

/** A field: long, slow waves for large surfaces — the hero, a travel header. */
function field({ w = 1200, h = 600, lines = 46 }) {
  const paths = [];
  for (let k = 0; k < lines; k++) {
    const t = k / (lines - 1);
    const base = h * (0.02 + t * 0.96);
    const pts = [];
    for (let x = 0; x <= w; x += 8) {
      const u = (x / w) * Math.PI * 2;
      const y =
        base +
        28 * Math.sin(u * 1.5 + t * 5.2) +
        14 * Math.sin(u * 3.2 - t * 9.1) +
        6 * Math.sin(u * 7.7 + t * 2.3);
      pts.push([x, y]);
    }
    paths.push(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(''));
  }
  return svg(w, h, paths, 0.7);
}

/** Meridians and parallels, gently curved — the ground for a route. */
function meridians({ w = 1200, h = 600 }) {
  const paths = [];
  for (let i = -8; i <= 8; i++) {
    const x0 = w / 2 + i * 70;
    const bow = i * 22;
    paths.push(`M${f(x0)} 0Q${f(x0 + bow)} ${f(h / 2)} ${f(x0)} ${f(h)}`);
  }
  for (let j = 1; j < 9; j++) {
    const y0 = (j / 9) * h;
    paths.push(`M0 ${f(y0)}Q${f(w / 2)} ${f(y0 - 36)} ${f(w)} ${f(y0)}`);
  }
  return svg(w, h, paths, 0.8);
}

function svg(w, h, paths, strokeWidth) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    paths.map((d) => `<path d="${d}"/>`).join('') +
    '</svg>\n'
  );
}

const files = {
  'rosette.svg': rosette({}),
  'band.svg': band({}),
  'field.svg': field({}),
  'meridians.svg': meridians({}),
};
for (const [name, body] of Object.entries(files)) {
  await writeFile(path.join(out, name), body);
  console.log(`${name}  ${(body.length / 1024).toFixed(1)} KB`);
}
