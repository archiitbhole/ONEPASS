/**
 * The brand mark and the wordmark — the only two places the product's name is
 * drawn rather than written. Both read `BRAND` in lib/brand.ts, so a new name
 * is a change there and nowhere else.
 */
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

/**
 * The mark: a rounded square with an opening in its ring — one pass, one way
 * through. It is deliberately not a QR code or a letter, so it survives a
 * change of name without redrawing.
 *
 * `tone` chooses the ink: `accent` on the page, `stock` on a printed object
 * (where the page accent would clash with the object's own colour).
 */
export function BrandMark({ size = 22, tone = 'accent' }: { size?: number; tone?: 'accent' | 'stock' }) {
  const fill = tone === 'stock' ? '#d6f2e4' : 'var(--accent)';
  const ink = tone === 'stock' ? '#06382b' : 'var(--accent-ink)';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      <rect x="1" y="1" width="22" height="22" rx="6.5" fill={fill} />
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" stroke="#fff" strokeOpacity="0.18" />
      <path d="M12 6.4a5.6 5.6 0 1 0 5.6 5.6" stroke={ink} strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.9" fill={ink} />
    </svg>
  );
}

/** The name, split into its ink and accent parts as BRAND.wordmark says. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `brand-name ${className}` : 'brand-name'}>
      {BRAND.wordmark.lead}
      <span className="brand-tail">{BRAND.wordmark.tail}</span>
    </span>
  );
}

/**
 * Mark + wordmark as a link home. `subtitle` names a console ("Business") and
 * is set apart by a rule, so it reads as a place in the product rather than
 * as part of the name.
 */
export function Brand({ href = '/', subtitle, label }: { href?: string; subtitle?: string; label?: string }) {
  return (
    <Link className="brand" href={href} aria-label={label ?? (subtitle ? `${BRAND.name} ${subtitle}` : `${BRAND.name} home`)}>
      <BrandMark />
      <Wordmark />
      {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
    </Link>
  );
}
