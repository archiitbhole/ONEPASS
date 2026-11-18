/**
 * The objects: pass, ticket, receipt, certificate, poster.
 *
 * These are the things a person carries, so they are drawn as things — printed
 * stock with engraved line-work, a microprinted rail, a foil — rather than as
 * another card. The material lives in styles/objects.css; these components are
 * the structure, composed from parts so each screen can say what it has
 * without a prop for every variation:
 *
 *   <Pass seed={ref} href="/pass">
 *     <Pass.Top status="Active" />
 *     <Pass.Holder name="Meera Kulkarni" reference="px_…" />
 *   </Pass>
 *
 *   <Ticket kind="event" state="valid">
 *     <Ticket.Main>
 *       <Ticket.Band label="Event ticket" />
 *       <Ticket.Title>Phoenix · Screen 2</Ticket.Title>
 *       <Ticket.Fields items={[…]} />
 *     </Ticket.Main>
 *     <Ticket.Stub>…code…</Ticket.Stub>
 *   </Ticket>
 *
 * Every decorative layer is `aria-hidden` and carries nothing the text does not
 * also say. Server components throughout; the only client code is
 * <ObjectLight>, which moves the foil under a pointer on capable devices.
 */
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { BrandMark } from '@/components/brand';

// ── deterministic variation ─────────────────────────────────

/**
 * A small stable hash, so an object's line-work is the same every time it is
 * drawn and different from the next object's. Seeded from a public reference,
 * never from anything personal, and nothing about the reference can be read
 * back out of an angle.
 */
export function seedOf(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Pattern = 'rosette' | 'band' | 'field' | 'meridians';

/** Engraved line-work. Position it with `className`/`style`; colour comes from the parent. */
export function Guilloche({
  pattern = 'rosette',
  seed,
  className,
  style,
}: {
  pattern?: Pattern;
  seed?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const s = seed ? seedOf(seed) : 0;
  const vars = seed
    ? ({ '--g-rot': `${s % 360}deg`, '--g-pos': `${40 + (s % 21)}% ${40 + ((s >> 5) % 21)}%` } as CSSProperties)
    : undefined;
  const cls = pattern === 'rosette' ? 'guilloche' : `guilloche guilloche-${pattern}`;
  return <div className={className ? `${cls} ${className}` : cls} style={{ ...vars, ...style }} aria-hidden="true" />;
}

/** The product name at a size you need a loupe for. Texture, never information. */
export function Microprint({ className, repeat = 18 }: { className?: string; repeat?: number }) {
  const line = Array.from({ length: repeat }, () => BRAND.microprint).join(' · ');
  return (
    <div className={className ? `microprint ${className}` : 'microprint'} aria-hidden="true">
      {line}
    </div>
  );
}

export function Foil() {
  return <div className="foil" aria-hidden="true" />;
}

// ── the pass ────────────────────────────────────────────────

interface PassProps {
  /** A public reference — seeds the line-work so every pass is its own. */
  seed: string;
  /** When set, the whole card is a link (home, the dock) to the opened pass. */
  href?: string;
  /** Accessible name of the card as a whole. */
  label?: string;
  /** `view-transition-name`, so the card can travel into the opened pass. */
  transitionName?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The pass at rest: an ID-1 card. It is not the live code — /pass mints that —
 * it is the object that says whose it is and that it is active.
 */
export function Pass({ seed, href, label, transitionName, className, children }: PassProps) {
  const style = transitionName ? ({ viewTransitionName: transitionName } as CSSProperties) : undefined;
  const cls = `pass object-lit${className ? ` ${className}` : ''}`;
  const inner = (
    <>
      <Guilloche seed={seed} />
      <Guilloche pattern="band" />
      <Foil />
      {children}
      <Microprint />
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls} style={style} aria-label={label}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={cls} style={style} role={label ? 'group' : undefined} aria-label={label}>
      {inner}
    </div>
  );
}

Pass.Top = function PassTop({ status, live = true }: { status: ReactNode; live?: boolean }) {
  return (
    <div className="pass-top">
      <span className="pass-issuer">
        <BrandMark size={18} tone="stock" />
        {BRAND.name}
      </span>
      <span className="pass-status">
        <span className={live ? 'dot dot-live' : 'dot'} aria-hidden="true" />
        {status}
      </span>
    </div>
  );
};

Pass.Chip = function PassChip() {
  return <div className="pass-chip" aria-hidden="true" />;
};

Pass.Holder = function PassHolder({
  name,
  reference,
  meta,
  aside,
}: {
  name: string;
  reference?: string;
  meta?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="pass-holder">
      <div style={{ minWidth: 0 }}>
        {meta ? <p className="pass-meta">{meta}</p> : null}
        <p className="pass-name">{name}</p>
        {reference ? <p className="pass-ref">{reference}</p> : null}
      </div>
      {aside}
    </div>
  );
};

// ── tickets ─────────────────────────────────────────────────

export type TicketKind = 'boarding' | 'event' | 'venue' | 'city' | 'credential';
export type TicketState = 'valid' | 'used' | 'void' | 'expired' | 'pending';

interface TicketProps {
  kind: TicketKind;
  state?: TicketState;
  href?: string;
  label?: string;
  /** Stack the stub under the face on a phone rather than beside it. */
  stack?: boolean;
  transitionName?: string;
  className?: string;
  children: ReactNode;
}

export function Ticket({ kind, state = 'valid', href, label, stack = true, transitionName, className, children }: TicketProps) {
  const style = transitionName ? ({ viewTransitionName: transitionName } as CSSProperties) : undefined;
  const cls = `ticket${stack ? ' ticket-stack' : ''}${className ? ` ${className}` : ''}`;
  // The notches are cut from the inner sheet with a mask; the shadow is on the
  // outer element, because a filter on the masked element itself would be
  // masked away with the notch.
  const sheet = <div className="ticket-sheet">{children}</div>;
  if (href) {
    return (
      <Link href={href} className={cls} data-kind={kind} data-state={state} style={style} aria-label={label}>
        {sheet}
      </Link>
    );
  }
  return (
    <article className={cls} data-kind={kind} data-state={state} style={style} aria-label={label}>
      {sheet}
    </article>
  );
}

Ticket.Main = function TicketMain({ children }: { children: ReactNode }) {
  return <div className="ticket-main">{children}</div>;
};

Ticket.Band = function TicketBand({ label, right }: { label: ReactNode; right?: ReactNode }) {
  return (
    <div className="ticket-band">
      <Guilloche pattern="band" />
      <span className="ticket-kind">{label}</span>
      {right ? <span className="ticket-kind">{right}</span> : null}
    </div>
  );
};

Ticket.Title = function TicketTitle({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 | 3 }) {
  const H = level === 1 ? 'h1' : level === 3 ? 'h3' : 'h2';
  return <H className="ticket-title">{children}</H>;
};

Ticket.Route = function TicketRoute({
  from,
  to,
  fromCity,
  toCity,
}: {
  from: string;
  to: string;
  fromCity?: string;
  toCity?: string;
}) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="ticket-route" aria-label={`${fromCity ?? from} to ${toCity ?? to}`}>
        <span className="ticket-iata" aria-hidden="true">{from}</span>
        <span className="leg" aria-hidden="true" />
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none', opacity: 0.7 }}>
          <path d="M2 13.5 22 7l-3 5 3 5-20-6.5 6-.8z" fill="currentColor" />
        </svg>
        <span className="leg" aria-hidden="true" />
        <span className="ticket-iata" aria-hidden="true">{to}</span>
      </div>
      {fromCity || toCity ? (
        <div className="row-between" aria-hidden="true">
          <span className="ticket-label">{fromCity}</span>
          <span className="ticket-label">{toCity}</span>
        </div>
      ) : null}
    </div>
  );
};

export interface TicketField {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

Ticket.Fields = function TicketFields({ items }: { items: TicketField[] }) {
  return (
    <dl className="ticket-fields">
      {items.map((f) => (
        <div className="ticket-field" key={f.label}>
          <dt className="ticket-label">{f.label}</dt>
          <dd className={f.mono ? 'ticket-value mono' : 'ticket-value'}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
};

Ticket.Stub = function TicketStubPart({ children }: { children: ReactNode }) {
  return <div className="ticket-stub">{children}</div>;
};

Ticket.Stamp = function TicketStamp({ tone = 'neutral', children }: { tone?: 'ok' | 'bad' | 'neutral' | 'info'; children: ReactNode }) {
  return <span className={`ticket-stamp ${tone}`}>{children}</span>;
};

// ── receipt ─────────────────────────────────────────────────

export function Receipt({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <article className="receipt" aria-label={label}>
      {children}
    </article>
  );
}

Receipt.Head = function ReceiptHead({ merchant, children }: { merchant: string; children?: ReactNode }) {
  return (
    <header className="receipt-head">
      <p className="receipt-merchant">{merchant}</p>
      {children}
    </header>
  );
};

Receipt.Lines = function ReceiptLines({ children }: { children: ReactNode }) {
  return <div className="receipt-lines">{children}</div>;
};

Receipt.Line = function ReceiptLine({ label, value, muted }: { label: ReactNode; value: ReactNode; muted?: boolean }) {
  return (
    <div className={muted ? 'receipt-line receipt-muted' : 'receipt-line'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
};

Receipt.Total = function ReceiptTotal({ label = 'Total', value }: { label?: string; value: ReactNode }) {
  return (
    <div className="receipt-total">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
};

// ── certificate: warranties, credentials ────────────────────

export function Certificate({ seed, children, className }: { seed?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `certificate ${className}` : 'certificate'}>
      <Guilloche seed={seed} />
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}

Certificate.Seal = function CertificateSeal({ children }: { children?: ReactNode }) {
  return (
    <span className="certificate-seal" aria-hidden="true">
      {children ?? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s7-3.5 7-9V5.5L12 3 5 5.5V12c0 5.5 7 9 7 9z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      )}
    </span>
  );
};

// ── poster: a drawn image for a place we have no photograph of ──

const KIND_GLYPH: Record<string, ReactNode> = {
  CINEMA: <path d="M4 7h16v11H4zM4 7l2-3h12l2 3M9 11l5 2.5L9 16z" />,
  HOTEL: <path d="M3 20V9l9-5 9 5v11M8 20v-5h8v5M9 11h.01M15 11h.01" />,
  RESTAURANT: <path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9" />,
  RETAIL: <path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" />,
  ATTRACTION: <path d="M3 20h18M5 20V10l7-6 7 6v10M10 20v-5h4v5" />,
  EVENT: <path d="M4 5h16v14H4zM4 9h16M9 3v4M15 3v4" />,
};

/**
 * A venue's poster. We do not own photographs of these places, and stock
 * photography would imply a place looks like something it may not — so each
 * venue gets a printed poster: its kind, its city, and line-work seeded from
 * its name.
 */
export function Poster({
  kind,
  seed,
  city,
  ratio,
  children,
}: {
  kind: string;
  seed: string;
  city?: string | null;
  ratio?: string;
  children?: ReactNode;
}) {
  return (
    <div className="poster" data-kind={kind.toUpperCase()} style={ratio ? ({ '--poster-ratio': ratio } as CSSProperties) : undefined} aria-hidden="true">
      <Guilloche seed={seed} />
      <svg className="poster-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {KIND_GLYPH[kind.toUpperCase()] ?? KIND_GLYPH.EVENT}
      </svg>
      <div style={{ position: 'relative' }}>
        {children}
        {city ? <p className="poster-city">{city}</p> : null}
      </div>
    </div>
  );
}
