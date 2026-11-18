/**
 * The things a person actually opens the app to do.
 *
 * The dock carries five destinations and has to stay that size — a bar with
 * eleven entries is a bar nobody reads. But several real surfaces had no route
 * in from anywhere: gifts, split, the city pass, the quests, what you own and
 * what partners have seen were reachable only by typing the URL or through the
 * palette.
 *
 * So this is the overflow, on home, where somebody looking for something goes
 * first: a grid of destinations rather than a menu. On a phone these are
 * thumb-sized targets, and the glyph carries the recognition so the label can
 * stay short. Each entry names a feature key, so anything not fully live is
 * chipped from the registry rather than from a hardcoded label here.
 */
import Link from 'next/link';
import { Glyph, type GlyphName } from '@/components/icons';
import { StatusChip } from '@/components/system';
import { feature } from '@/lib/features';
import { BRAND } from '@/lib/brand';

interface Action {
  href: string;
  label: string;
  sub: string;
  glyph: GlyphName;
  featureKey?: string;
}

const ACTIONS: Action[] = [
  { href: '/gifts', label: 'Gifts', sub: 'Send or claim', glyph: 'gift', featureKey: 'gifts' },
  { href: '/split', label: 'Split', sub: 'Share a bill', glyph: 'split', featureKey: 'split' },
  { href: '/city-pass', label: 'City Pass', sub: 'What it covers', glyph: 'city', featureKey: 'city-pass' },
  { href: '/explore-quests', label: 'Quests', sub: 'Explore the city', glyph: 'quest', featureKey: 'quests' },
  { href: '/products', label: 'Your things', sub: 'Own, give, sell', glyph: 'product' },
  { href: '/returns', label: 'Returns', sub: 'Track a case', glyph: 'returns' },
  { href: '/disclosures', label: 'Shared', sub: 'Who saw what', glyph: 'eye' },
  { href: '/help', label: 'Help', sub: 'Ask a person', glyph: 'help' },
];

export function QuickActions() {
  return (
    <nav className="qa" aria-label={`More in ${BRAND.name}`}>
      {ACTIONS.map((a) => {
        const status = a.featureKey ? feature(a.featureKey)?.status : undefined;
        // Only chip what is not simply live — a "Live" badge on every tile is
        // noise, and it makes the two that genuinely need a caveat invisible.
        const chip = status && status !== 'LIVE' ? a.featureKey : undefined;

        return (
          <Link key={a.href} href={a.href} className="qa-item">
            {chip ? (
              <span className="qa-chip">
                <StatusChip featureKey={chip} />
              </span>
            ) : null}
            <span className="qa-mark" aria-hidden="true">
              <Glyph name={a.glyph} size={18} />
            </span>
            <span className="qa-label">{a.label}</span>
            <span className="qa-sub">{a.sub}</span>
          </Link>
        );
      })}
    </nav>
  );
}
