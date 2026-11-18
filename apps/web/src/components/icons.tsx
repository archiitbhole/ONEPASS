/**
 * The glyph set.
 *
 * One drawing hand for the whole product: a 24-unit grid, a 1.75 stroke, round
 * joins, no fills except where a dot is the point. Inline SVG rather than a
 * library because a library would ship as client JavaScript and draw in
 * someone else's hand.
 *
 * Every glyph is decorative (`aria-hidden`). A glyph never carries meaning on
 * its own — the label beside it, or the control's accessible name, does.
 */
import type { ReactNode } from 'react';

const PATHS = {
  home: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9v11h13V9" /><path d="M10 20v-5.5h4V20" /></>,
  explore: <><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2.3 4.7-4.7 2.3 2.3-4.7z" /></>,
  pass: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><rect x="6" y="9" width="4.5" height="3.5" rx="0.8" /><path d="M6 15.5h7M14.5 9.5h3.5M14.5 12.5h2.5" /></>,
  travel: <><path d="M2.5 13.8 21.5 7.5l-2.8 4.8 2.8 4.9-19-6.3 5.6-.8z" /><path d="M8.1 10.3 12 15.2" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="3.5" y="8" width="17" height="11" rx="2.5" /><path d="M16.5 13.5h.01" /></>,
  plan: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /><path d="m9 14.5 2 2 4-4" /></>,
  profile: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  ticket: <><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z" /><path d="M14.5 6v12" strokeDasharray="1.6 2.2" /></>,
  receipt: <><path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" /><path d="M9 8h6M9 11.5h6M9 15h3.5" /></>,
  shield: <><path d="M12 21s7-3.3 7-9V5.8L12 3 5 5.8V12c0 5.7 7 9 7 9z" /><path d="m9 12 2 2 4-4" /></>,
  gift: <><rect x="4" y="9" width="16" height="11" rx="1.5" /><path d="M3 9h18M12 9v11" /><path d="M12 9c-1.5-3.5-5-4-5-1.5S12 9 12 9zM12 9c1.5-3.5 5-4 5-1.5S12 9 12 9z" /></>,
  split: <><path d="M12 3.5v6.5" /><path d="M12 10 6 20.5M12 10l6 10.5" /><circle cx="12" cy="3.5" r="0.5" /></>,
  city: <><path d="M3 20.5h18" /><path d="M5 20.5V9l5-3v14.5M10 11h5v9.5M15 20.5V4.5l4 2v14" /><path d="M7.5 11h.01M7.5 14h.01M12.5 14h.01M17 9h.01M17 12h.01" /></>,
  quest: <><path d="M5 21V4" /><path d="M5 4.5h11l-2 3.5 2 3.5H5" /></>,
  returns: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4" /><path d="M12 16.8h.01" /></>,
  product: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2" /><circle cx="12" cy="12" r="7" /></>,
  logout: <><path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></>,
  chevron: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  back: <><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cross: <><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></>,
  alert: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.8v5" /><path d="M12 16.2h.01" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  scan: <><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  moon: <path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  external: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></>,
  webhook: <><circle cx="6.5" cy="17" r="2.5" /><circle cx="17.5" cy="17" r="2.5" /><circle cx="12" cy="6.5" r="2.5" /><path d="m10.8 8.7-3.2 6M9 17h6M13.2 8.7l3.2 6" /></>,
  door: <><path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21" /><path d="M3 21h18" /><path d="M14.5 12h.01" /></>,
  chart: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="m7.5 15 3.5-4 3 2.5 5-6" /></>,
  users: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5a6 6 0 0 1 12 0" /><path d="M15.5 5.5a3.2 3.2 0 0 1 0 6M17.5 14a6 6 0 0 1 3.5 5.5" /></>,
  building: <><rect x="5" y="3.5" width="14" height="17" rx="1.5" /><path d="M9 7.5h.01M15 7.5h.01M9 11h.01M15 11h.01M9 14.5h.01M15 14.5h.01M10.5 20.5v-3h3v3" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  card: <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M6.5 14.5h4" /></>,
  tag: <><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8L21 12l-8.5 8.5z" /><circle cx="8" cy="8" r="1.4" /></>,
  savings: <><path d="M4 11a8 7 0 0 1 14.5-2.5H20v5h-1.6A8 7 0 0 1 16 16v3h-3v-1.6a8.5 8.5 0 0 1-2 0V19H8v-3a7 7 0 0 1-4-5z" /><path d="M14.5 10.5h.01" /></>,
  sparkline: <path d="M3 16.5 8 11l4 3.5 5-7 4 4" />,
  pin: <><path d="M12 21s6.5-5.8 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.2 6.5 11 6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  filter: <path d="M4 5.5h16l-6.2 7.2v5.8l-3.6 1.5v-7.3z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  dot: <circle cx="12" cy="12" r="3.5" />,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4v4.5H15" /></>,
  download: <><path d="M12 4v11" /><path d="m7 10.5 5 5 5-5" /><path d="M5 20h14" /></>,
  trash: <><path d="M4.5 7h15" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l1 13h9l1-13" /></>,
  signal: <><path d="M5 18h.01" /><path d="M9 18v-4" /><path d="M13 18V10" /><path d="M17 18V6" /></>,
  offline: <><path d="M3 3l18 18" /><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.8a10 10 0 0 1 4-2.4M19 12.8a10 10 0 0 0-3.7-2.3M2 9.3a15 15 0 0 1 4.7-2.9M22 9.3a15 15 0 0 0-10-3.8" /><path d="M12 20h.01" /></>,
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof PATHS;

export function Glyph({
  name,
  size = 20,
  strokeWidth = 1.75,
  className,
}: {
  name: GlyphName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flex: 'none' }}
    >
      {PATHS[name]}
    </svg>
  );
}
