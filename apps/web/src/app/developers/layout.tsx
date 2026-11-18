/**
 * The developer platform shell.
 *
 * Everything under /developers shares this: its own register, a persistent
 * sidebar, and a search index built once here from the catalogue rather than in
 * each page. The index is assembled on the server and handed down as a prop —
 * `api-catalog.ts` computes its example dates at module load, so importing it
 * into the client palette would recompute them in the reader's timezone and
 * produce a hydration mismatch on the one part of the product whose whole job
 * is to look dependable.
 *
 * `data-surface="developer"` is the fourth register in the design system. A
 * reference is neither a storefront nor a control room — it is something you
 * keep open in a second tab — so the ambience drops to a quarter and the accent
 * cools.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Brand } from '@/components/ui';
import { Ambient } from '@/components/system';
import { DocsNav, type NavGroup } from '@/components/developers/nav';
import { DocsSearch, type SearchEntry } from '@/components/developers/search';
import { ENDPOINTS, ERROR_DOCS, EVENT_DOCS, GROUPS } from '@/lib/api-catalog';
import { BRAND, titleTemplate } from '@/lib/brand';
import { SiteFooter } from '@/components/site/chrome';

export const metadata: Metadata = {
  title: { default: 'Developers', template: titleTemplate(`${BRAND.name} developers`) },
  description:
    `Verify a ${BRAND.name} credential from your own systems, issue credentials, and receive signed webhooks. One open endpoint, a published proof, and no account required to check anything.`,
};

/**
 * Regenerate daily.
 *
 * The examples carry dates relative to today, so a page rendered once at build
 * time would slowly start describing a credential issued last year. A day is
 * the right granularity: the dates only change at a day boundary anyway.
 */
export const revalidate = 86_400;

const NAV: NavGroup[] = [
  {
    heading: 'Start here',
    links: [
      { href: '/developers', label: 'Overview' },
      { href: '/developers/verify', label: 'Verify a credential' },
    ],
  },
  {
    heading: 'Reference',
    links: [
      {
        href: '/developers/api',
        label: 'API reference',
        children: GROUPS.map((g) => ({ href: `#group-${g.id}`, label: g.name })),
      },
      {
        href: '/developers/webhooks',
        label: 'Webhooks',
        children: [
          { href: '#signature', label: 'Signatures' },
          { href: '#catalogue', label: 'Event catalogue' },
          { href: '#delivery', label: 'Delivery and retries' },
        ],
      },
      { href: '/developers/realtime', label: 'Live events' },
      { href: '/developers/errors', label: 'Errors' },
    ],
  },
  {
    heading: 'How it works',
    links: [
      {
        href: '/developers/architecture',
        label: 'System reference',
        children: [
          { href: '#shape', label: 'Shape' },
          { href: '#identity', label: 'Identity' },
          { href: '#isolation', label: 'Isolation' },
          { href: '#credentials', label: 'Credentials' },
          { href: '#money', label: 'Money' },
          { href: '#realtime', label: 'Real time' },
          { href: '#limits', label: 'Known limits' },
        ],
      },
      { href: '/developers/status', label: 'What is built' },
    ],
  },
];

/**
 * The search index.
 *
 * Built from the same data the pages render, so an entry cannot point at a
 * heading that no longer exists. `terms` carries the words a developer actually
 * types — a field name, an event type, a status code — which are usually not
 * in the title.
 */
function buildIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];

  for (const group of GROUPS) {
    entries.push({
      title: group.name,
      where: 'API',
      href: `/developers/api#group-${group.id}`,
      terms: group.blurb,
    });
  }

  for (const e of ENDPOINTS) {
    entries.push({
      title: `${e.method} ${e.path}`,
      where: e.title,
      href: `/developers/api#${e.id}`,
      // Parameter names are the highest-value search terms on a reference page
      // and appear in no title anywhere.
      terms: `${e.summary} ${e.params.map((p) => p.name).join(' ')} ${e.permission ?? ''} ${e.scope ?? ''}`,
    });
  }

  for (const d of EVENT_DOCS) {
    entries.push({
      title: d.type,
      where: 'Webhook event',
      href: `/developers/webhooks#${d.type}`,
      terms: d.when,
    });
  }

  for (const d of ERROR_DOCS) {
    entries.push({
      title: `${d.code} · ${d.status}`,
      where: 'Error',
      href: `/developers/errors#${d.code}`,
      terms: `${d.meaning} ${d.fix}`,
    });
  }

  for (const group of NAV) {
    for (const link of group.links) {
      entries.push({ title: link.label, where: group.heading, href: link.href });
      for (const child of link.children ?? []) {
        entries.push({
          title: child.label,
          where: link.label,
          href: `${link.href}${child.href}`,
        });
      }
    }
  }

  return entries;
}

export default function DevelopersLayout({ children }: { children: ReactNode }) {
  const index = buildIndex();

  return (
    <div className="shell" data-surface="developer">
      <Ambient />

      <header className="topbar">
        <div className="wrap topbar-inner">
          <Brand subtitle="Developers" />
          <nav className="navlinks" aria-label="Main">
            <Link className="navlink navlink-secondary" href="/verify">
              Verify
            </Link>
            <Link className="navlink navlink-secondary" href="/pricing">
              Pricing
            </Link>
            <Link className="btn btn-sm btn-primary" href="/sign-in">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="section">
        <div className="wrap docs-layout">
          <div>
            <DocsSearch entries={index} />
            <DocsNav groups={NAV} />
          </div>
          <div className="stack stack-7">{children}</div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
