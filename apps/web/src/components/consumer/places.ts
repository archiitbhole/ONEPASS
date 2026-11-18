/**
 * Every screen in the consumer app, written down once.
 *
 * Three things read this list: the dock on a phone (the five `dock` entries,
 * the pass at its centre), the bar on a desktop (the `desk` entries), and the
 * command palette, which offers all of it. Before this file the tab bar was the
 * only list there was, which meant that two thirds of the app had no route to
 * it except a link on some other page. Thirty-odd screens are more than any bar
 * can hold, and the answer to that is a search box rather than a longer bar.
 *
 * `keywords` are the words somebody would actually type. They are not synonyms
 * for the label — matching the label is already free — they are the other name
 * for the thing: "refund" for returns, "cashback" for savings, "boarding pass"
 * for tickets. Where a person's own vocabulary and the product's disagree, this
 * is where the disagreement is resolved.
 *
 * Plain data, no JSX: the navigation is a client component and so is the
 * palette, and a module both can import has to be small enough to be free.
 */
import { BRAND } from '@/lib/brand';

export interface Place {
  href: string;
  label: string;
  /** The group it belongs to, shown on the right of a palette row. */
  where: string;
  /** Other words that should find it. */
  keywords?: string;
  /** Sub-paths this entry owns, for `aria-current` — /tickets/tkt_… is still "Pass". */
  owns?: string[];
  /** In the phone dock. Five of them; order here is order there, and the pass sits in the middle. */
  dock?: true;
  /** In the desktop bar. */
  desk?: true;
}

export const PLACES: Place[] = [
  // ── the dock and the desktop bar ──
  {
    href: '/home',
    label: 'Home',
    where: BRAND.name,
    keywords: 'start dashboard overview today',
    dock: true,
    desk: true,
  },
  {
    href: '/plan',
    label: 'Plan',
    where: BRAND.name,
    keywords: 'plan my day itinerary schedule agenda',
    desk: true,
  },
  {
    href: '/travel',
    label: 'Travel',
    where: 'Travel',
    keywords: 'trips flights journeys',
    dock: true,
    desk: true,
  },
  {
    href: '/pass',
    label: 'Pass',
    where: BRAND.name,
    keywords: 'qr code identity show scan entry',
    owns: ['/tickets'],
    dock: true,
  },
  {
    href: '/explore',
    label: 'Explore',
    where: BRAND.name,
    keywords: 'discover nearby places what is on',
    owns: ['/deals'],
    dock: true,
    desk: true,
  },
  {
    href: '/wallet',
    label: 'Wallet',
    where: 'Money',
    keywords: 'balance points cards payment methods',
    owns: ['/savings', '/receipts'],
    dock: true,
    desk: true,
  },
  {
    href: '/profile',
    label: 'Profile',
    where: 'Account',
    keywords: 'account settings sign out security devices privacy',
    owns: ['/warranties', '/returns', '/bookings', '/disclosures', '/products'],
  },

  // ── everything else ──
  { href: '/tickets', label: 'Tickets', where: BRAND.name, keywords: 'boarding pass entry seat admit show' },
  { href: '/deals', label: 'Live deals', where: BRAND.name, keywords: 'offers discounts nearby now' },
  { href: '/city-pass', label: 'City Pass', where: BRAND.name, keywords: 'city day pass attractions' },
  { href: '/explore-quests', label: 'City Explorer', where: BRAND.name, keywords: 'quests challenges badges' },

  { href: '/bookings', label: 'Bookings', where: 'Account', keywords: 'reservations table room seat booked' },
  { href: '/receipts', label: 'Receipts', where: 'Money', keywords: 'bills invoices purchases spent' },
  { href: '/warranties', label: 'Warranties', where: 'Account', keywords: 'guarantee cover repair product expiry' },
  { href: '/products', label: 'Your products', where: 'Account', keywords: 'owned items things sell give transfer resale claim code' },
  { href: '/returns', label: 'Returns', where: 'Account', keywords: 'refund send back exchange' },
  { href: '/savings', label: 'Savings', where: 'Money', keywords: 'saved cashback rewards points earned' },
  { href: '/split', label: 'Split a bill', where: 'Money', keywords: 'share divide owe friends settle up' },
  { href: '/gifts', label: 'Gifts', where: 'Money', keywords: 'gift card voucher send present' },
  { href: '/help', label: 'Help', where: 'Account', keywords: 'support contact problem question ticket' },
  { href: '/notifications', label: 'Notifications', where: 'Account', keywords: 'inbox alerts messages updates unread bell' },
  { href: '/settings', label: 'Settings', where: 'Account', keywords: 'preferences appearance theme dark mode notifications edit name phone export delete account' },
  { href: '/disclosures', label: 'Shared with others', where: 'Account', keywords: 'privacy disclosures who saw data consent shared history' },

  { href: '/travel/flights', label: 'Search flights', where: 'Travel', keywords: 'fly air fare one way return book' },
  { href: '/travel/trips', label: 'Your trips', where: 'Travel', keywords: 'itinerary pnr booked flights journeys' },
  { href: '/travel/stay', label: 'Travel mode', where: 'Travel', keywords: 'away offline abroad trip mode' },
  { href: '/travel/rewards', label: 'Travel rewards', where: 'Travel', keywords: 'points miles earn cashback flights' },
  { href: '/travel/discounts', label: 'Travel discounts', where: 'Travel', keywords: 'bank offer card discount promo' },

  { href: '/travel/airindex', label: 'AirIndex', where: 'AirIndex', keywords: 'fare index prices intelligence' },
  { href: '/travel/airindex/routes', label: 'Route explorer', where: 'AirIndex', keywords: 'routes sectors city pair' },
  { href: '/travel/airindex/airlines', label: 'Airline comparison', where: 'AirIndex', keywords: 'carriers compare airlines' },
  { href: '/travel/airindex/history', label: 'Price history', where: 'AirIndex', keywords: 'trend past chart over time' },
  { href: '/travel/airindex/observations', label: 'Observations', where: 'AirIndex', keywords: 'samples raw data export csv' },
  { href: '/travel/airindex/quality', label: 'Data quality', where: 'AirIndex', keywords: 'coverage freshness confidence sample' },
  { href: '/travel/airindex/methodology', label: 'Methodology', where: 'AirIndex', keywords: 'how it works formula reference fare' },
];

const DOCK_ORDER = ['/home', '/explore', '/pass', '/travel', '/wallet'];
const DESK_ORDER = ['/home', '/explore', '/plan', '/travel', '/wallet'];

/** The five in the phone dock, in dock order — the pass third, under the thumb. */
export const DOCK_PLACES: Place[] = DOCK_ORDER.map((h) => PLACES.find((p) => p.href === h && p.dock)).filter(
  (p): p is Place => Boolean(p),
);

/** The desktop bar. The pass has its own control there, and Profile is the avatar. */
export const DESK_PLACES: Place[] = DESK_ORDER.map((h) => PLACES.find((p) => p.href === h && p.desk)).filter(
  (p): p is Place => Boolean(p),
);

/** Is this path inside that destination? */
export function placeIsActive(pathname: string, place: Place): boolean {
  // Home is the one exact match: every path is "inside" `/` conceptually, and a
  // bar with two lit tabs tells a person nothing.
  if (place.href === '/home') return pathname === '/home';
  if (pathname === place.href || pathname.startsWith(`${place.href}/`)) return true;
  return (place.owns ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
