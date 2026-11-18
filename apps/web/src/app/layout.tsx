/**
 * The document shell.
 *
 * Fonts are self-hosted from @fontsource rather than fetched from a font CDN.
 * Two reasons, and the second is the real one. First: the build must not
 * depend on reaching a third party — a CI runner without egress should still
 * produce a working bundle. Second: a font fetched from someone else's server
 * is a request every visitor makes to them, carrying their IP and the page
 * they are on. Self-hosting removes that and keeps font-src at 'self'.
 *
 * The type pairing is Archivo — one variable family, width and weight both on
 * axes, doing the work of display, figures and condensed ticket labels — with
 * IBM Plex for reading and for code. See src/styles/tokens.css.
 */
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { canonicalOrigin } from '@/lib/site';
import { BRAND, titleTemplate } from '@/lib/brand';
import { PerformanceTier } from '@/components/system/performance-tier';
import { THEME_COOKIE, parseTheme } from '@/components/system/theme';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
// The design system, in dependency order: tokens first, then the document,
// the class layer, the shells, the printed objects, light and motion, and
// the two surfaces with components of their own.
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/components.css';
import '@/styles/shell.css';
import '@/styles/objects.css';
import '@/styles/effects.css';
import '@/styles/palette.css';
import '@/styles/developers.css';
import '@/styles/surfaces/consumer.css';
import '@/styles/surfaces/discover.css';
import '@/styles/surfaces/travel.css';
import '@/styles/surfaces/console.css';
import '@/styles/surfaces/public.css';

/**
 * `metadataBase` is what makes every relative URL below absolute.
 *
 * Without it, Next resolves Open Graph and canonical URLs against localhost at
 * build time, so a shared link previews as a broken image and a canonical tag
 * points at a machine nobody else can reach. It is read from APP_URL rather than
 * hardcoded, so a deployment gets its own origin without a code change.
 */
const origin = canonicalOrigin();
const DEFAULT_TITLE = `${BRAND.name} — ${BRAND.tagline.toLowerCase()}`;

/**
 * Nothing is prerendered, and that is a security decision rather than a
 * performance oversight.
 *
 * The CSP in `middleware.ts` is nonce-based: every response carries a fresh
 * `'nonce-…'` in `script-src`, and Next stamps that same nonce onto the script
 * tags it renders. A prerendered page is rendered once, at build time, so its
 * script tags carry a nonce from that build — and every subsequent response
 * carries a different one. The browser compares them, finds they do not match,
 * and refuses every script on the page.
 *
 * The failure is completely silent. The HTML is correct, the styling is
 * correct, the page looks finished — and no JavaScript runs on it at all. It
 * cost `/pricing` and `/verify` their entire client runtime for as long as this
 * application has been built for production, and it went unnoticed because
 * `next dev` renders every page per request, so the nonce always matched
 * wherever the tests were looking.
 *
 * There is no way for middleware to know whether the response it is decorating
 * came from a render or from a cache, so there is no way to send the right
 * nonce for a prerendered page. The choice is between a nonce-based CSP and
 * static prerendering; this application is session-driven and almost entirely
 * dynamic already, so the eleven pages that were static are a small price for a
 * policy that actually holds.
 *
 * `e2e/csp.spec.ts` runs against a production build and fails if any page
 * serves a script the browser refuses, so this cannot quietly come back.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: { default: DEFAULT_TITLE, template: titleTemplate() },
  description: BRAND.description,
  applicationName: BRAND.name,
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: BRAND.shortName, statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: '48x48' }],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: BRAND.name,
    title: DEFAULT_TITLE,
    description: BRAND.description,
    url: '/',
    locale: 'en_IN',
    images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: BRAND.name }],
  },
  twitter: {
    card: 'summary',
    title: DEFAULT_TITLE,
    description: BRAND.description,
    images: ['/icons/icon-512.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: BRAND.themeColor.light },
    { media: '(prefers-color-scheme: dark)', color: BRAND.themeColor.dark },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // A stated preference is stamped here, on the server, so the first paint is
  // already in the right theme. No attribute means "follow the system".
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-IN" data-theme={theme === 'system' ? undefined : theme} data-tier="standard">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        <PerformanceTier />
      </body>
    </html>
  );
}
