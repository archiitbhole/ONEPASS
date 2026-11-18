/**
 * The public site's header and footer — landing, pricing, verification and the
 * offline page share them, so the way in and the way around are the same
 * everywhere a person arrives without an account.
 *
 * Server components. The header asks who is signed in so it can offer the
 * way back into the app instead of a second sign-in; the footer reads the
 * theme cookie so its appearance control starts on the right choice.
 */
import Link from 'next/link';
import { cookies } from 'next/headers';
import { Brand } from '@/components/ui';
import { ThemeToggle } from '@/components/system/theme-toggle';
import { THEME_COOKIE, parseTheme } from '@/components/system/theme';
import { getActor } from '@/lib/authz/authorize';
import { BRAND } from '@/lib/brand';

type Section = 'home' | 'verify' | 'developers' | 'pricing';

const LINKS: { href: string; label: string; section: Section }[] = [
  { href: '/verify', label: 'Verify', section: 'verify' },
  { href: '/developers', label: 'Developers', section: 'developers' },
  { href: '/pricing', label: 'Pricing', section: 'pricing' },
];

export async function SiteHeader({ current, tone }: { current?: Section; tone?: 'immersive' }) {
  const actor = await getActor();
  return (
    <header className={tone === 'immersive' ? 'topbar site-header site-header-immersive' : 'topbar site-header'}>
      <div className="wrap topbar-inner">
        <Brand href="/" />
        <nav className="navlinks" aria-label="Site">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={l.section === 'pricing' ? 'navlink navlink-secondary' : 'navlink'}
              aria-current={current === l.section ? 'page' : undefined}
            >
              {current === l.section ? <span className="bead" aria-hidden="true" /> : null}
              {l.label}
            </Link>
          ))}
          {actor ? (
            <Link href="/home" className="btn btn-primary btn-sm site-header-cta">
              Open {BRAND.name}
            </Link>
          ) : (
            <Link href="/sign-in" className="btn btn-primary btn-sm site-header-cta">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <footer className="site-footer">
      <div className="wrap stack stack-6">
        <div className="site-footer-grid">
          <div className="stack stack-3">
            <Brand href="/" />
            <p className="small muted" style={{ maxWidth: '36ch' }}>
              {BRAND.tagline}. Consent over what every business sees, and a record of what they saw.
            </p>
          </div>
          <div>
            <h2>Product</h2>
            <ul>
              <li><Link href="/sign-up">Create an account</Link></li>
              <li><Link href="/sign-in">Sign in</Link></li>
              <li><Link href="/pricing">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <h2>Trust</h2>
            <ul>
              <li><Link href="/verify">Verify a credential</Link></li>
              <li><Link href="/developers/verify">Check a proof yourself</Link></li>
              <li><Link href="/developers/status">What works today</Link></li>
            </ul>
          </div>
          <div>
            <h2>Developers</h2>
            <ul>
              <li><Link href="/developers">Documentation</Link></li>
              <li><Link href="/developers/api">API reference</Link></li>
              <li><Link href="/developers/webhooks">Webhooks</Link></li>
            </ul>
          </div>
        </div>
        <div className="row-between site-footer-base">
          <span className="small muted">
            © {BRAND.name} · {BRAND.tagline.toLowerCase()}
          </span>
          <ThemeToggle initial={theme} compact />
        </div>
      </div>
    </footer>
  );
}
