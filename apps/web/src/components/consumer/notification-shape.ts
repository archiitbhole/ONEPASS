/**
 * How a notification reads: what kind of thing it is, and where it points.
 *
 * Plain data and pure functions, no JSX — the inbox is a client component and
 * the page that renders it is a server one, and both need the same answers.
 *
 * The only interesting part is `safeLinkPath`. A notification's `link_path` is
 * a column, written by whichever service caused the notification, and a column
 * is not a promise: it can hold a path to a screen that has since been renamed,
 * and a future writer could put an absolute URL in it. So nothing here follows
 * a path it has not looked at.
 */
import type { GlyphName } from '@/components/icons';

export type NotificationCategory = 'SECURITY' | 'TRANSACTION' | 'CONSENT' | 'PARTNER' | 'ACCOUNT' | 'PRODUCT';

export interface CategoryShape {
  label: string;
  glyph: GlyphName;
  /** The badge tone. Security is the only one that is ever alarming. */
  tone: 'bad' | 'accent' | 'info' | 'value' | 'neutral';
}

const SHAPES: Record<string, CategoryShape> = {
  SECURITY: { label: 'Security', glyph: 'shield', tone: 'bad' },
  TRANSACTION: { label: 'Money', glyph: 'receipt', tone: 'value' },
  CONSENT: { label: 'Sharing', glyph: 'eye', tone: 'info' },
  PARTNER: { label: 'Partner', glyph: 'building', tone: 'accent' },
  ACCOUNT: { label: 'Account', glyph: 'profile', tone: 'neutral' },
  PRODUCT: { label: 'Things you own', glyph: 'product', tone: 'accent' },
};

export function categoryShape(category: string): CategoryShape {
  return SHAPES[category] ?? { label: 'Update', glyph: 'bell', tone: 'neutral' };
}

/**
 * Screens that were renamed after notifications had already been written
 * pointing at them.
 *
 * These rows are in the database and cannot be edited retrospectively — a
 * notification is a record of what was said at the time. Rewriting the
 * *destination* as it is read is not rewriting the record; it is the difference
 * between an old notice that still takes you somewhere and one that 404s. The
 * services that write these paths have been corrected, so this list only ever
 * gets shorter.
 */
const MOVED: [prefix: string, becomes: string][] = [
  ['/app/security', '/profile'],
  ['/app/connections', '/profile'],
  ['/app/consents', '/profile'],
  ['/app/privacy', '/settings'],
  ['/app/account', '/settings'],
  ['/app/pass', '/pass'],
  ['/account/security', '/profile'],
  // `lib/commerce/split.ts` notifies on `/splits/<ref>`; the screen is `/split/<ref>`.
  ['/splits/', '/split/'],
];

/**
 * A link a notification may be rendered with, or null.
 *
 * Relative and same-origin only: a value beginning `//` is protocol-relative and
 * goes to another host, and anything with a scheme is not this app. A stored
 * string is never turned into an off-site link, whatever wrote it.
 */
export function safeLinkPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.includes('..')) return null;

  for (const [prefix, becomes] of MOVED) {
    if (value === prefix) return becomes;
    if (prefix.endsWith('/') && value.startsWith(prefix)) return `${becomes}${value.slice(prefix.length)}`;
  }
  return value;
}

/**
 * The day a notification belongs to, in India, as a sortable key and a heading.
 *
 * Grouped in Asia/Kolkata rather than the viewer's zone: everything else in the
 * product — a month of savings, a booking window — is decided there, and an
 * inbox whose "Today" disagreed with the rest of the app would be its own bug.
 */
export function dayKey(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
}

export function dayHeading(key: string, now: Date = new Date()): string {
  const today = dayKey(now);
  if (key === today) return 'Today';
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  if (key === yesterday) return 'Yesterday';

  // Midday, so the label cannot be pushed into the previous day by the offset.
  const at = new Date(`${key}T12:00:00+05:30`);

  // Two formatters joined by hand rather than one with `weekday` in it.
  // `en-IN` with weekday + day + month resolves to "Monday 21 September" under
  // Node's ICU and "Monday, 21 September" under Chromium's, which is a
  // hydration mismatch in a client component the server also renders — React
  // throws the subtree away and redraws it. Formatting the two halves
  // separately and joining them here gives both runtimes the same string.
  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(at);
  const date = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    ...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    timeZone: 'Asia/Kolkata',
  }).format(at);
  return `${weekday}, ${date}`;
}
