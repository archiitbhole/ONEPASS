/**
 * The shared primitives.
 *
 * Server components by default — none of these carries `'use client'`, so they
 * render on the server and ship no JavaScript. Anything that needs interactivity
 * is a separate client component that composes these, rather than these becoming
 * client components to suit one caller.
 *
 * Styling is the class layer in app/globals.css. No CSS-in-JS, no utility
 * framework: the app is mostly server-rendered onto phones on patchy
 * connections, and a hand-written sheet beats shipping a runtime for it.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Glyph } from '@/components/icons';

// ── money and time ───────────────────────────────────────────

/**
 * Paise → rupees, formatted for India.
 *
 * The only place minor units become a string. Everything upstream stays integer
 * paise, which is why this is a formatter rather than a conversion helper that
 * might tempt someone to do arithmetic on the result.
 */
export function formatMoney(minor: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

/**
 * An amount, set as a figure: the rupees carry the reading, the symbol and
 * the paise are smaller. The accessible name is the plain formatted string,
 * so a screen reader hears "₹1,234.50" rather than three fragments.
 */
export function Money({ minor, currency = 'INR', className }: { minor: number; currency?: string; className?: string }) {
  const parts = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).formatToParts(minor / 100);
  let symbol = '';
  let whole = '';
  let fraction = '';
  for (const p of parts) {
    if (p.type === 'currency') symbol += p.value;
    else if (p.type === 'decimal' || p.type === 'fraction') fraction += p.value;
    else if (p.type !== 'literal') whole += p.value;
  }
  return (
    <span className={className ? `money ${className}` : 'money'} aria-label={formatMoney(minor, currency)}>
      <span className="money-sym" aria-hidden="true">{symbol}</span>
      <span aria-hidden="true">{whole}</span>
      {fraction ? <span className="money-minor" aria-hidden="true">{fraction}</span> : null}
    </span>
  );
}

export function formatDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(typeof d === 'string' ? new Date(d) : d);
}

export function formatDate(d: Date | string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(typeof d === 'string' ? new Date(d) : d);
}

/**
 * "in 3 days", "2 hours ago" — relative, so a stale page reads as stale.
 *
 * `now` is a parameter rather than `Date.now()` so a component the server also
 * renders can be given one clock for both passes. Left out, it reads the
 * browser's — correct for anything rendered only on the client.
 */
export function formatRelative(d: Date | string, now: Date | number = Date.now()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = date.getTime() - (typeof now === 'number' ? now : now.getTime());
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

// ── layout ───────────────────────────────────────────────────

export function Stack({
  gap = 4,
  children,
  className = '',
}: {
  gap?: 2 | 3 | 4 | 5 | 6 | 7;
  children: ReactNode;
  className?: string;
}) {
  return <div className={`stack stack-${gap} ${className}`}>{children}</div>;
}

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
}) {
  return <Tag className={`card ${className}`}>{children}</Tag>;
}

export function CardHead({
  title,
  action,
  level = 2,
}: {
  title: ReactNode;
  action?: ReactNode;
  /**
   * `1` when this card's title is the page's only heading.
   *
   * A card is usually a section inside a page that has its own `h1`, so `h2` is
   * right by default — but two screens were built entirely out of cards and
   * ended up with no `h1` at all, which leaves anyone navigating by headings
   * with no way in. The fix is to say which card is the page, not to bolt a
   * duplicate title above it.
   */
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <div className="card-head">
      <Heading className="h3">{title}</Heading>
      {action}
    </div>
  );
}

export function Divider() {
  return <hr className="divider" />;
}

/**
 * How a page opens: an eyebrow, the title, a sentence, and actions to the
 * right where there is room. One component so the rhythm cannot drift from
 * screen to screen.
 */
export function PageHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lede ? <p>{lede}</p> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
    </header>
  );
}

/** Initials in a stamped square — for businesses and people, never a photograph we do not have. */
export function Monogram({ name, size = 40, tone }: { name: string; size?: number; tone?: 'accent' | 'value' | 'info' | 'neutral' }) {
  const initials =
    name
      .split(/[\s—–-]+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w))
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '·';
  const colours: Record<string, [string, string]> = {
    accent: ['var(--accent)', 'var(--accent-soft)'],
    value: ['var(--value)', 'var(--value-soft)'],
    info: ['var(--info)', 'var(--info-soft)'],
    neutral: ['var(--ink-2)', 'var(--sunken)'],
  };
  const [ink, bg] = colours[tone ?? 'accent'] ?? colours.accent!;
  return (
    <span
      className="monogram"
      aria-hidden="true"
      style={{ '--mono-size': `${size}px`, '--mono-ink': ink, '--mono-bg': bg } as React.CSSProperties}
    >
      {initials}
    </span>
  );
}

export type StepState = 'done' | 'current' | 'todo' | 'failed';

/** A sequence of states — a booking, a payment, a return — as stations on a line. */
export function Steps({ label, steps }: { label: string; steps: { label: ReactNode; state: StepState; detail?: ReactNode }[] }) {
  return (
    <ol className="steps" aria-label={label}>
      {steps.map((step, i) => (
        <li key={i} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
          <span>{step.label}</span>
          {step.detail ? <span className="tiny muted">{step.detail}</span> : null}
          <span className="sr-only">
            {step.state === 'done' ? ' (done)' : step.state === 'failed' ? ' (failed)' : step.state === 'current' ? ' (current)' : ' (not yet)'}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A proportion as a bar, with the numbers said in words for assistive technology. */
export function Meter({
  value,
  max,
  label,
  tone,
}: {
  value: number;
  max: number;
  label: string;
  tone?: 'accent' | 'ok' | 'value' | 'warn' | 'bad';
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      className={tone ? `meter meter-${tone}` : 'meter'}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── indicators ───────────────────────────────────────────────

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent' | 'value';

export function Badge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/**
 * A status word mapped to a tone, in one place.
 *
 * Every console shows these strings, and a booking that reads green in one
 * screen and grey in another is a screen nobody trusts.
 */
const STATUS_TONES: Record<string, Tone> = {
  // bookings
  HELD: 'warn', CONFIRMED: 'ok', CHECKED_IN: 'accent', COMPLETED: 'ok',
  CANCELLED: 'neutral', NO_SHOW: 'bad', EXPIRED: 'neutral',
  // offers
  DRAFT: 'neutral', SCHEDULED: 'info', LIVE: 'ok', PAUSED: 'warn',
  SOLD_OUT: 'accent', ENDED: 'neutral',
  // tickets
  ISSUED: 'ok', ADMITTED: 'accent', VOID: 'bad', TRANSFERRED: 'info',
  // payments
  INITIATED: 'warn', AUTHORIZED: 'info', CAPTURED: 'ok', FAILED: 'bad', REFUNDED: 'info',
  // returns
  REQUESTED: 'warn', UNDER_REVIEW: 'info', APPROVED: 'ok', REJECTED: 'bad',
  IN_TRANSIT: 'info', REPLACED: 'ok', CLOSED: 'neutral',
  // organizations, users
  ACTIVE: 'ok', PENDING_REVIEW: 'warn', SUSPENDED: 'bad',
  PENDING_VERIFICATION: 'warn', DEACTIVATED: 'neutral',
  // verification outcomes
  VERIFIED: 'ok', PENDING: 'warn', INVALID: 'bad', NOT_FOUND: 'neutral', REVOKED: 'bad',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} dot>
      {status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  );
}

export function Notice({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

/**
 * Marks anything the platform did not observe directly.
 *
 * Used on estimates, seeded history and sandbox payments. It exists so a screen
 * can never quietly present a projection as a fact — the brief is explicit that
 * sample and simulated content must be labelled, and a shared component makes that
 * cheaper to do than to skip.
 */
export function EstimateTag({ children = 'Estimate' }: { children?: ReactNode }) {
  return (
    <span className="badge badge-info" title="Computed from historical rows, not an observed value">
      {children}
    </span>
  );
}

export function SampleTag({ children = 'Sample data' }: { children?: ReactNode }) {
  return (
    <span className="badge badge-warn" title="Seeded sample data; not a real transaction">
      {children}
    </span>
  );
}

// ── numbers ──────────────────────────────────────────────────

export function Stat({
  label,
  value,
  hint,
  tone = 'accent',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    // A named group, so a statistic can be found by what it is rather than by
    // the class it happens to be styled with. The browser tests reached in via
    // `.card .num`, which meant restyling a component broke five assertions that
    // were not about styling at all — and a screen reader got an unlabelled div.
    // `stat-rail-*` rather than `stat-${tone}`: the figure's own class is
    // `.stat-value`, so a tone of "value" used to put that class on the
    // container and set the whole card — label, figure and hint — in the
    // display face at the figure's weight.
    <div className={`stat stat-rail-${tone}`} role="group" aria-label={label}>
      <p className="stat-label">{label}</p>
      {/* The tone is a rail on the edge, not the colour of the figure.
          Tinting the number itself made the alarming one the hardest to read at
          exactly the moment it mattered — and on a console showing six at once,
          what an operator needs first is to know *which* one to look at. */}
      <p className="stat-value">{value}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  );
}

/**
 * A row of statistics.
 *
 * `auto-fit` with a 200px floor: three or four across on a laptop, one on a
 * phone, and no breakpoint anyone has to keep in step with the number of stats
 * a given page happens to show.
 */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="stat-row">{children}</div>;
}

export function DefinitionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="dl">
      {items.map(([term, value], i) => (
        <div key={i}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── actions ──────────────────────────────────────────────────

export function Button({
  children,
  variant = 'default',
  size,
  block,
  type = 'button',
  ...rest
}: {
  children: ReactNode;
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'value';
  size?: 'sm' | 'lg';
  block?: boolean;
  type?: 'button' | 'submit' | 'reset';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [
    'btn',
    variant !== 'default' ? `btn-${variant}` : '',
    size ? `btn-${size}` : '',
    block ? 'btn-block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'default',
  size,
  block,
}: {
  href: string;
  children: ReactNode;
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'value';
  size?: 'sm' | 'lg';
  block?: boolean;
}) {
  const cls = [
    'btn',
    variant !== 'default' ? `btn-${variant}` : '',
    size ? `btn-${size}` : '',
    block ? 'btn-block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

// ── forms ────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor: string;
  /** For a surface that has to address one field — to hide it, or to span it. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

// ── empty and loading ────────────────────────────────────────

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="h3">{title}</p>
      {body ? <p className="small muted" style={{ marginTop: 6 }}>{body}</p> : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}

export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="table-scroll">{children}</div>;
}

// ── brand ────────────────────────────────────────────────────
// Drawn in components/brand.tsx from lib/brand.ts, and re-exported here because
// every screen already imports its primitives from this file.
export { Brand, BrandMark, Wordmark } from '@/components/brand';

// ── icons ────────────────────────────────────────────────────
// The older call shape, kept for the screens that use it. New code uses
// <Glyph name="…"> from components/icons.tsx, which draws the same set.
export const Icon = {
  check: (s = 16) => <Glyph name="check" size={s} strokeWidth={2} />,
  cross: (s = 16) => <Glyph name="cross" size={s} strokeWidth={2} />,
  alert: (s = 16) => <Glyph name="alert" size={s} strokeWidth={2} />,
  clock: (s = 16) => <Glyph name="clock" size={s} strokeWidth={2} />,
  arrow: (s = 16) => <Glyph name="arrow" size={s} strokeWidth={2} />,
  shield: (s = 16) => <Glyph name="shield" size={s} strokeWidth={2} />,
  scan: (s = 16) => <Glyph name="scan" size={s} strokeWidth={2} />,
};
