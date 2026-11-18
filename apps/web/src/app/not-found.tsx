/**
 * 404.
 *
 * This page carries more weight in ONEPASS than in most applications, because
 * `notFound()` is also what the authorization guards throw. A consumer who
 * reaches a partner console URL, a partner who reaches another organization's
 * page, anyone at all who reaches `/control` without platform staff — all of
 * them land here rather than on a 403.
 *
 * That is deliberate: a 403 confirms the thing exists, which turns a URL bar
 * into a way of enumerating other tenants. So this page says the same thing to
 * everybody and never hints that a page might be there for someone else. The
 * copy is written with that in mind — "we could not find" rather than "you do
 * not have access".
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Ambient } from '@/components/system';
import { SiteHeader, SiteFooter } from '@/components/site/chrome';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false, follow: false },
};

export default async function NotFound() {
  return (
    <>
      <Ambient />
      {/* The site chrome, not a bare page. Somebody who reaches a 404 is by
          definition somewhere they did not mean to be, and a screen with no way
          out is the one place a header earns its keep most. */}
      <SiteHeader />
      {/* A `main` landmark with the id the root layout's skip link points at.
          Both of these pages render inside that layout and neither provided
          one, so "Skip to content" went nowhere on the two screens a person is
          most likely to reach by accident — and there was no landmark for a
          screen reader to jump to at all. */}
      <main id="main">
        <div className="wrap section page-centre">
          <div className="stack stack-5 page-centre-text">
            <p className="eyebrow">404</p>
            {/*
              The wording is load-bearing. `expectNotFound` in e2e/helpers.ts
              matches /could not be found/i, and it is asserted on every isolation
              test — a consumer reaching a partner console, a partner reaching
              another tenant. Those tests are checking that the refusal looks
              identical whoever asks, so the sentence itself is part of the
              contract rather than decoration.
            */}
            <h1 className="display h1">That page could not be found</h1>
            <p className="lede">
              The link may be old, or the address may have a typo in it. Nothing is broken.
            </p>
            <div className="row-wrap">
              <Link href="/home" className="btn btn-primary">
                Your {BRAND.name}
              </Link>
              <Link href="/explore" className="btn">
                Explore
              </Link>
              <Link href="/verify" className="btn btn-ghost">
                Verify a credential
              </Link>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
