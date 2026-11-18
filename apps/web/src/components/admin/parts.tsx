/**
 * The few pieces of furniture the Control screens repeat.
 *
 * Everything else on these pages comes from `@/components/ui` and from
 * `@/components/partner/shell` — `PageHeader`, `Summary` and `FilterLinks` are
 * console furniture rather than partner furniture, and a second copy of them
 * under a different name is how two consoles start disagreeing about what a
 * filter strip looks like.
 *
 * Server components throughout. Nothing here needs a browser.
 */
import type { ReactNode } from 'react';
import { Badge, Card, Notice } from '@/components/ui';
import { humaniseKey } from '@/components/partner/evidence';

/**
 * A section this actor's role does not open.
 *
 * Shown instead of the section rather than in place of the whole page, because
 * "platform support cannot see platform-wide money" is a fact about the role that
 * is worth reading on the screen. The data behind it was never queried — the page
 * checks the permission before it runs the query, not after.
 */
export function Withheld({ what, permission }: { what: string; permission: string }) {
  return (
    <Card>
      <p className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <Badge tone="neutral">Not your role</Badge>
        <span className="small muted">
          {what} needs <span className="mono">{permission}</span>, which your platform role does not
          hold. Nothing behind this section was read.
        </span>
      </p>
    </Card>
  );
}

/** The banner a server action redirects back with. Situations, not faults. */
export function ActionOutcome({ error, done }: { error?: string | null; done?: string | null }) {
  if (error) {
    return (
      <Notice tone="bad">
        <p>{error}</p>
      </Notice>
    );
  }
  if (done) {
    return (
      <Notice tone="ok">
        <p>{done}</p>
      </Notice>
    );
  }
  return null;
}

/** One JSON scalar, printed as it is stored. Never rounded, never reshaped. */
function scalar(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * The evidence attached to a security event or an audit entry.
 *
 * It is rendered rather than hidden behind a "view raw" toggle because an alert
 * nobody can check is an alert nobody acts on: `hashIntact: false` is the whole
 * finding, and it belongs next to the summary that claims it.
 *
 * The object is already stripped of anything credential-shaped by `sanitise()` on
 * write (src/lib/audit.ts), so what arrives here is safe to show. The key is
 * printed as stored alongside its readable form, so a figure on the screen can be
 * matched to a row in the table.
 */
export function MetadataTable({ metadata }: { metadata: unknown }) {
  if (metadata === null || metadata === undefined || typeof metadata !== 'object') {
    return <p className="tiny muted">No evidence was recorded with this entry.</p>;
  }

  const entries = Object.entries(metadata as Record<string, unknown>);
  if (entries.length === 0) {
    return <p className="tiny muted">No evidence was recorded with this entry.</p>;
  }

  return (
    <dl className="dl">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt title={key}>{humaniseKey(key)}</dt>
          <dd className="mono break-all">{scalar(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A yes/no fact about an account, as a badge rather than an empty cell. */
export function YesNo({
  value,
  yes,
  no,
  yesTone = 'ok',
  noTone = 'neutral',
}: {
  value: boolean;
  yes: string;
  no: string;
  yesTone?: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent';
  noTone?: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent';
}) {
  return <Badge tone={value ? yesTone : noTone}>{value ? yes : no}</Badge>;
}

/** A label/value pair inside a card, for the dense identity strips. */
export function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <p className="eyebrow">{term}</p>
      <p className="small" style={{ marginTop: 2 }}>
        {children}
      </p>
    </div>
  );
}
