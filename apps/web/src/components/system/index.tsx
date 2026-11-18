/**
 * The premium component layer.
 *
 * `components/ui.tsx` holds the original kit — Card, Badge, Stat, Button and
 * the rest — and every screen already uses it. This adds the pieces that kit
 * never had, rather than replacing it: ambient surfaces, a feature-status chip
 * backed by the registry, section headers with a consistent rhythm, and the
 * four states (loading, empty, error, offline) that were previously written
 * afresh on each page or missing entirely.
 *
 * Everything here is a server component unless it genuinely needs the browser.
 * That is not a stylistic preference — a marketing page that ships an animation
 * runtime to render a heading is the exact trade this project has been careful
 * not to make.
 */
import type { ReactNode } from 'react';
import { FEATURE_STATUS, feature, type FeatureStatus } from '@/lib/features';

/* ───────────────────────────────────────────────────────────
   Ambience
   ─────────────────────────────────────────────────────────── */

/**
 * The drawn background. Fixed behind everything, inert, and free of network
 * cost — three radial gradients and, optionally, a masked rule grid.
 *
 * `grid` suits a hero or a developer surface where a sense of structure helps.
 * It is wrong behind a dense table, where it competes with the rows.
 */
export function Ambient({ grid = false, drift = true }: { grid?: boolean; drift?: boolean }) {
  return (
    <div className={`ambient${drift ? ' ambient-drift' : ''}`} aria-hidden="true">
      {grid ? <div className="ambient-grid" /> : null}
    </div>
  );
}

/** A single soft light. Position it with `style`. */
export function Glow({ style, className }: { style?: React.CSSProperties; className?: string }) {
  return <div className={`glow${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />;
}

/* ───────────────────────────────────────────────────────────
   Feature status
   ─────────────────────────────────────────────────────────── */

/**
 * The status chip. Reads the registry rather than taking a label, so the same
 * capability cannot be "coming soon" on one screen and "beta" on another.
 *
 * Passing `status` directly is for surfaces describing something not in the
 * registry — a city that has not launched, say, rather than a product feature.
 */
export function StatusChip({
  featureKey,
  status,
  label,
}: {
  featureKey?: string;
  status?: FeatureStatus;
  label?: string;
}) {
  const found = featureKey ? feature(featureKey) : undefined;
  const resolved = status ?? found?.status;
  if (!resolved) return null;

  const meta = FEATURE_STATUS[resolved];
  const hint = found?.note ?? meta.hint;

  return (
    <span className={`chip chip-${meta.tone}`} title={hint}>
      {label ?? meta.label}
    </span>
  );
}

/**
 * The honest note that belongs beside a feature which is not fully live.
 *
 * Renders nothing at all for a LIVE feature, so a caller can drop it in
 * unconditionally and it stays out of the way until there is something true to
 * say.
 */
export function FeatureNote({ featureKey }: { featureKey: string }) {
  const found = feature(featureKey);
  if (!found || found.status === 'LIVE') return null;

  const meta = FEATURE_STATUS[found.status];

  return (
    <p className="small muted" style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'baseline' }}>
      <span className={`chip chip-${meta.tone}`}>{meta.label}</span>
      <span>
        {found.note ?? meta.hint}
        {found.blockedOn ? ` Waiting on: ${found.blockedOn.toLowerCase()}.` : ''}
      </span>
    </p>
  );
}

/* ───────────────────────────────────────────────────────────
   Structure
   ─────────────────────────────────────────────────────────── */

/**
 * A section header with one rhythm for the whole product.
 *
 * Previously each page assembled an eyebrow, a heading and a lede by hand, and
 * the spacing between them drifted by a few pixels per screen. One component
 * means one answer.
 */
export function SectionHead({
  eyebrow,
  title,
  lede,
  action,
  center = false,
  as: Heading = 'h2',
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  action?: ReactNode;
  center?: boolean;
  as?: 'h1' | 'h2' | 'h3';
}) {
  const headingClass = Heading === 'h1' ? 'display h1' : Heading === 'h2' ? 'h2' : 'h3';

  return (
    <div
      className="row-between"
      style={{ alignItems: 'flex-end', textAlign: center ? 'center' : undefined }}
    >
      <div className="stack stack-2" style={{ maxWidth: '62ch', marginInline: center ? 'auto' : undefined }}>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <Heading className={headingClass}>{title}</Heading>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {action ? <div className="row-wrap">{action}</div> : null}
    </div>
  );
}

/** A premium surface. `tone` picks how much presence it has. */
export function Panel({
  children,
  tone = 'solid',
  lift = false,
  sheen = false,
  className,
  style,
}: {
  children: ReactNode;
  tone?: 'solid' | 'quiet' | 'glass' | 'glass-strong';
  lift?: boolean;
  sheen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const base =
    tone === 'glass'
      ? 'glass'
      : tone === 'glass-strong'
        ? 'glass glass-strong'
        : tone === 'quiet'
          ? 'surface surface-quiet'
          : 'surface';

  const classes = [base, lift ? 'lift' : '', sheen ? 'sheen' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────
   The four states.

   Every important screen needs all of them, and before this they were either
   hand-written per page or absent. `error.tsx` and `loading.tsx` files across
   the app now render these, so the states are consistent by construction.
   ─────────────────────────────────────────────────────────── */

/**
 * A skeleton shaped like the thing that is loading.
 *
 * Shape matters: a block of generic grey bars tells a person nothing and makes
 * the layout jump when the real content lands. These mirror the geometry of
 * what replaces them.
 */
export function Skeleton({
  variant = 'text',
  lines = 3,
  className,
}: {
  variant?: 'text' | 'card' | 'stat' | 'table' | 'row';
  lines?: number;
  className?: string;
}) {
  if (variant === 'stat') {
    return (
      <div className={`surface stack stack-3${className ? ` ${className}` : ''}`} aria-hidden="true">
        <div className="skeleton" style={{ height: 11, width: '55%' }} />
        <div className="skeleton" style={{ height: 30, width: '42%' }} />
        <div className="skeleton" style={{ height: 11, width: '72%' }} />
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={`surface stack stack-4${className ? ` ${className}` : ''}`} aria-hidden="true">
        <div className="skeleton" style={{ height: 14, width: '45%' }} />
        <div className="skeleton" style={{ height: 90, width: '100%', borderRadius: 'var(--r-m)' }} />
        <div className="skeleton" style={{ height: 11, width: '80%' }} />
        <div className="skeleton" style={{ height: 11, width: '60%' }} />
      </div>
    );
  }

  if (variant === 'table') {
    return (
      <div className={`stack stack-2${className ? ` ${className}` : ''}`} aria-hidden="true">
        <div className="skeleton" style={{ height: 34, width: '100%', borderRadius: 'var(--r-s)' }} />
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 44, width: '100%', borderRadius: 'var(--r-s)' }} />
        ))}
      </div>
    );
  }

  if (variant === 'row') {
    return <div className={`skeleton${className ? ` ${className}` : ''}`} style={{ height: 44 }} aria-hidden="true" />;
  }

  return (
    <div className={`stack stack-2${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{ height: 12, width: i === lines - 1 ? '55%' : '100%' }}
        />
      ))}
    </div>
  );
}

/**
 * The page-level loading state.
 *
 * `aria-busy` and a polite live region, so a screen reader is told the page is
 * working rather than being read an empty document.
 */
export function LoadingState({ label = 'Loading', children }: { label?: string; children?: ReactNode }) {
  return (
    <div aria-busy="true" aria-live="polite" className="stack stack-5">
      <span className="sr-only">{label}…</span>
      {children ?? (
        <>
          <Skeleton variant="text" lines={2} />
          <div className="grid grid-3">
            <Skeleton variant="stat" />
            <Skeleton variant="stat" />
            <Skeleton variant="stat" />
          </div>
          <Skeleton variant="table" lines={4} />
        </>
      )}
    </div>
  );
}

/**
 * The error state.
 *
 * Two things distinguish this from a generic apology. It offers a way out —
 * retry, or somewhere else to go — and it surfaces the request id when there is
 * one, because that eight-character string is the difference between a support
 * conversation that can find the failure in the logs and one that cannot.
 */
export function ErrorState({
  title = 'That did not load',
  body,
  requestId,
  action,
}: {
  title?: string;
  body?: ReactNode;
  requestId?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="surface stack stack-4" role="alert" style={{ textAlign: 'center', padding: 'var(--s-7)' }}>
      <div className="stack stack-2">
        <h2 className="h2">{title}</h2>
        <p className="lede" style={{ marginInline: 'auto', maxWidth: '48ch' }}>
          {body ?? 'Something on our side failed while putting this page together. Nothing you did caused it, and nothing was lost.'}
        </p>
      </div>
      {action ? <div className="row-wrap" style={{ justifyContent: 'center' }}>{action}</div> : null}
      {requestId ? (
        <p className="tiny muted">
          Quote this if you contact support: <code className="mono">{requestId}</code>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The offline state.
 *
 * Says which parts still work rather than only that the network is gone — the
 * pass, tickets and receipts are readable from cache, and a person standing at
 * a door with no signal needs to know that immediately.
 */
export function OfflineState({ works }: { works?: string[] }) {
  return (
    <div className="surface stack stack-4" role="status" style={{ padding: 'var(--s-6)' }}>
      <div className="stack stack-2">
        <span className="chip chip-config">Offline</span>
        <h2 className="h3">You are not connected</h2>
        <p className="small muted">
          This page needs the network. It will load as soon as you are back.
        </p>
      </div>
      {works && works.length > 0 ? (
        <div className="stack stack-2">
          <p className="tiny eyebrow">Still available</p>
          <ul className="stack stack-1">
            {works.map((w) => (
              <li key={w} className="small">
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
