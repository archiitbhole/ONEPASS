'use client';

/**
 * The rotating pass code.
 *
 * The server mints a 30-second envelope and encodes it; this component draws that
 * matrix and counts the window down. When the window closes it asks the server for
 * the next one with `router.refresh()`, which re-runs the page's server component —
 * so the pass secret, the minting and the encoder all stay on the server, and the
 * browser only ever holds a picture that is worthless in thirty seconds.
 *
 * The canvas is sized to a whole number of device pixels per module. A QR scaled to
 * a fractional pixel gets resampled, the finder patterns blur, and a phone camera at
 * an angle stops reading it — which is the whole job of this screen.
 */
import { BRAND } from '@/lib/brand';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const QUIET_MODULES = 4;

export function PassCanvas({
  rows,
  expiresInSeconds,
  stepSeconds,
  framed = true,
  maxCssPx = 320,
}: {
  /** The QR matrix as '0'/'1' strings, one per row. */
  rows: string[];
  expiresInSeconds: number;
  stepSeconds: number;
  /**
   * Draw the white plate around the code. False when the caller already
   * provides one — `PassHero` does, and two nested white boxes read as a
   * rendering mistake rather than as a frame.
   */
  framed?: boolean;
  /**
   * Cap on the drawn size in CSS pixels. The pass screen wants the code as
   * large as the viewport allows, because it is used at arm's length; a card
   * elsewhere wants it small. Whatever this is, the size is still floored to
   * whole module pixels below.
   */
  maxCssPx?: number;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const deadlineRef = useRef<number>(Date.now() + expiresInSeconds * 1000);
  const [remaining, setRemaining] = useState(expiresInSeconds);
  const [pending, startTransition] = useTransition();

  // Identity of the code currently on screen. A new envelope means a new matrix,
  // which is the only thing that should reset the countdown or redraw the canvas.
  const fingerprint = rows.join('');

  useEffect(() => {
    deadlineRef.current = Date.now() + expiresInSeconds * 1000;
    setRemaining(expiresInSeconds);
  }, [fingerprint, expiresInSeconds]);

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        // Push the deadline out by one full window first, so a slow refresh cannot
        // fire a second one every 250ms while it is still in flight.
        deadlineRef.current = Date.now() + stepSeconds * 1000;
        startTransition(() => router.refresh());
      }
    };
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [router, stepSeconds]);

  // Coming back to a backgrounded tab, the code on screen is almost certainly dead.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      deadlineRef.current = Date.now() + stepSeconds * 1000;
      startTransition(() => router.refresh());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router, stepSeconds]);

  // Bumped on resize, to re-run the draw below. The size is derived from the
  // element's own container, so a rotation or a window drag changes the right
  // answer — and a QR resampled to a fractional pixel is a QR a phone camera
  // stops reading, which is the one thing this component must not allow.
  const [measureTick, setMeasureTick] = useState(0);
  useEffect(() => {
    const onResize = () => setMeasureTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const modules = rows.length;
    if (!canvas || modules === 0) return;

    const span = modules + QUIET_MODULES * 2;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 4);

    // Measure the box this actually sits in, rather than subtracting a guess at
    // the chrome from the viewport width. The guess (`innerWidth - 88`) was
    // tuned for one caller and quietly wrong for the next: inside the pass
    // hero, the wrapper, card and plate padding come to 120px, so a 390px phone
    // got a 302px code in a 270px slot and the page scrolled sideways.
    const available = canvas.parentElement?.clientWidth ?? 0;
    const fromContainer = available > 0 ? available : window.innerWidth - 88;
    const targetCssPx = Math.min(maxCssPx, Math.max(160, fromContainer));
    const scale = Math.max(2, Math.floor((targetCssPx * dpr) / span));
    const sizeDevicePx = span * scale;

    canvas.width = sizeDevicePx;
    canvas.height = sizeDevicePx;
    canvas.style.width = `${sizeDevicePx / dpr}px`;
    canvas.style.height = `${sizeDevicePx / dpr}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    // Pure black on pure white. A scanner reads luminance, not the theme.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, sizeDevicePx, sizeDevicePx);
    ctx.fillStyle = '#000000';
    for (let y = 0; y < modules; y++) {
      const row = rows[y];
      if (!row) continue;
      for (let x = 0; x < modules; x++) {
        if (row[x] === '1') {
          ctx.fillRect((x + QUIET_MODULES) * scale, (y + QUIET_MODULES) * scale, scale, scale);
        }
      }
    }
  }, [fingerprint, rows, maxCssPx, measureTick]);

  const fraction = stepSeconds > 0 ? Math.min(1, Math.max(0, remaining / stepSeconds)) : 0;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="stack stack-4" style={{ alignItems: 'center' }}>
      {framed ? (
        <div className="qr-frame">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Your ${BRAND.name} code. Hold it to the reader.`}
            style={{ display: 'block' }}
          />
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Your ${BRAND.name} code. Hold it to the reader.`}
          style={{ display: 'block' }}
        />
      )}

      <div className="row" style={{ gap: 12 }}>
        <span style={{ position: 'relative', width: 60, height: 60, flex: 'none' }}>
          <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
            <circle cx="30" cy="30" r={radius} fill="none" stroke="var(--line)" strokeWidth="4" />
            <circle
              cx="30"
              cy="30"
              r={radius}
              fill="none"
              stroke={remaining <= 5 ? 'var(--warn)' : 'var(--accent)'}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - fraction)}
              transform="rotate(-90 30 30)"
              style={{ transition: 'stroke-dashoffset 250ms linear' }}
            />
          </svg>
          <span
            className="mono"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              fontSize: 15,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {remaining}
          </span>
        </span>

        <span className="small muted" role="status">
          {pending || remaining === 0
            ? 'Rolling to a new code…'
            : `New code in ${remaining} second${remaining === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  );
}
