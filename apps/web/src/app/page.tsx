/**
 * The landing page.
 *
 * The positioning problem this page has to solve is unchanged: ONEPASS looks
 * like a QR code app and is actually an infrastructure business. So the hero
 * still leads with the sentence rather than a phone mockup, and the proof
 * underneath it is still the real ecosystem numbers read from the database — a
 * landing page that quotes its own live data cannot drift from the product.
 *
 * What changed is everything around that. The page now opens with a drawn
 * product visual, routes the three audiences to their own entry points before
 * anything else, and reveals each section as it is scrolled to. The honesty
 * section stayed, and moved up: on a page this confident, the paragraph listing
 * what is *not* claimed is the most persuasive thing on it.
 *
 * Server-rendered with **no client JavaScript at all**. The scroll reveals are
 * the `.reveal` class in system.css, which rests visible and animates only
 * where the browser can drive it — an earlier version used a JS observer and
 * three of the four sections rendered blank whenever it had not hydrated.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import * as t from '@/db/schema';
import { redirect } from 'next/navigation';
import { getActor } from '@/lib/authz/authorize';
import { Brand, BrandMark, formatMoney } from '@/components/ui';
import { Ambient, SectionHead } from '@/components/system';
import { Pass } from '@/components/objects';
import { ObjectLight } from '@/components/system/object-light';
import { BRAND } from '@/lib/brand';
import { SiteFooter } from '@/components/site/chrome';

export const metadata: Metadata = {
  title: `${BRAND.name} — one identity across India’s physical commerce`,
  description:
    `${BRAND.name} is the identity, access and loyalty layer for physical commerce in India. One pass across hotels, cinemas, restaurants and shops — with consent, verification and settlement built in.`,
};

/** Live counts. Falls back silently if the database is unreachable — a marketing
 *  page must not 500 because a read failed, but it also must not invent a number. */
async function ecosystem() {
  try {
    const [row] = await db
      .select({
        partners: sql<number>`(select count(*) from ${t.organizations} where status = 'ACTIVE')::int`,
        venues: sql<number>`(select count(*) from ${t.venues} where is_active)::int`,
        cities: sql<number>`(select count(*) from ${t.cities} where is_live)::int`,
        liveDeals: sql<number>`(select count(*) from ${t.offers} where status = 'LIVE' and ends_at > now())::int`,
        saved: sql<number>`(select coalesce(sum(amount_minor), 0) from ${t.savingsEvents})::bigint`,
      })
      .from(sql`(select 1) as _`);
    return row ?? null;
  } catch {
    return null;
  }
}

const LAYERS = [
  { name: 'Identity', detail: 'One person, one record, verified once.' },
  { name: 'Access', detail: 'A rotating pass that proves it at a door.' },
  { name: 'Payments', detail: 'One rail, one reconciliation.' },
  { name: 'Loyalty', detail: 'Points that cross brands and settle between them.' },
  { name: 'Commerce', detail: 'Capacity, offers, bookings, receipts, returns.' },
  { name: 'Intelligence', detail: 'What partners learn, without learning about people.' },
];

/** The three doors. Ordered by how many people walk through each. */
const PATHS = [
  {
    href: '/sign-up',
    eyebrow: 'For people',
    title: 'One pass, everywhere you go',
    body: 'Your tickets, bookings, receipts, warranties and points in one place — and a code at the door that changes every thirty seconds.',
    cta: `Create your ${BRAND.name}`,
  },
  {
    href: '/pricing',
    eyebrow: 'For partners',
    title: 'Fill the capacity you were going to lose',
    body: 'Publish a deal against tonight’s empty seats, admit at the door, and see what it earned — on your own rows, not a model’s guess.',
    cta: 'See how partnering works',
  },
  {
    href: '/developers',
    eyebrow: 'For developers',
    title: 'Verify a credential in one request',
    body: 'A public verification API, signed webhooks, and an event stream. Plain HTTP and JSON, documented against the code that serves it.',
    cta: 'Read the API',
  },
];


export default async function LandingPage() {
  // `/` is the marketing page for a stranger and the app for a member.
  //
  // The consumer home lives at `/home` under the (app) group so it gets that
  // group's shell — nav, tab bar, session guard. A route group adds no URL
  // segment, so a page at `(app)/page.tsx` would have collided with this file
  // and Next would have silently resolved it in favour of the ungrouped one,
  // leaving a signed-in person looking at a "Sign in" button. Redirecting is
  // explicit about which of the two is meant.
  const actor = await getActor().catch(() => null);
  if (actor) redirect('/home');

  const stats = await ecosystem();

  return (
    <>
      <Ambient grid />

      <header className="topbar">
        <div className="wrap topbar-inner">
          <Brand />
          <nav className="navlinks" aria-label="Main">
            <Link className="navlink navlink-secondary" href="/verify">
              Verify
            </Link>
            <Link className="navlink navlink-secondary" href="/developers">
              Developers
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

      <main id="main">
        <section className="lp-hero">
          <div className="wrap lp-grid">
            <div>
              <p className="lp-eyebrow">
                <BrandMark size={16} />
                Identity, access and loyalty for physical commerce
              </p>
              <h1 className="lp-title">
                India&rsquo;s physical commerce runs on <em>a hundred separate identities</em>.
              </h1>
              <p className="lp-sub">
                A hotel knows you. The cinema next door does not. Neither does the shop, the
                restaurant, or the parking gate — so you prove who you are again at every counter,
                and every partner rebuilds the same customer record from scratch. {BRAND.name} is the
                layer underneath all of them: one identity, presented with consent, verified in
                about a second.
              </p>
              <div className="lp-cta">
                <Link className="btn btn-primary btn-lg" href="/sign-up">
                  Create your {BRAND.name}
                </Link>
                <Link className="btn btn-lg" href="/verify">
                  Verify a credential
                </Link>
              </div>
            </div>

            <div className="lp-visual">
              {/*
                The real object, not a drawing of one.

                This used to be a second implementation of a pass — its own
                gradient card, its own pseudo-QR, its own float chips, one of
                which read "Admitted · 0.4s". That number was invented: nothing
                measured it, and a latency figure on a hero is a claim like any
                other. The `<Pass>` here is the component the product issues,
                with a placeholder name and reference and a status that says
                what it is.
              */}
              <ObjectLight>
                <Pass seed="specimen" label={`A ${BRAND.name} pass`}>
                  <Pass.Top status="Specimen" live={false} />
                  <Pass.Chip />
                  <Pass.Holder
                    name={BRAND.fallbackPersonName}
                    reference="px_specimen"
                    meta="Holder"
                  />
                </Pass>
              </ObjectLight>
              <p className="lp-visual-note">
                A specimen, drawn by the same component that draws a real one. A pass carries a rotating code,
                the holder&rsquo;s name and nothing else — what a counter learns is decided by what you have
                consented to share with it.
              </p>
            </div>
          </div>
        </section>

        {stats ? (
          <section className="wrap" aria-label="Live ecosystem">
            <div className="lp-numbers">
              <div className="lp-number">
                <b>{stats.partners}</b>
                <span>active partners</span>
              </div>
              <div className="lp-number">
                <b>{stats.venues}</b>
                <span>venues</span>
              </div>
              <div className="lp-number">
                <b>{stats.cities}</b>
                <span>cities live</span>
              </div>
              <div className="lp-number">
                <b>{stats.liveDeals}</b>
                <span>deals running now</span>
              </div>
              <div className="lp-number">
                <b>{formatMoney(Number(stats.saved))}</b>
                <span>saved by members</span>
              </div>
            </div>
            <p className="tiny muted" style={{ marginTop: 'var(--s-3)' }}>
              Counted from this deployment&rsquo;s own database when the page was rendered.
            </p>
          </section>
        ) : null}

        {/* The three doors, before any further explanation. Somebody who already
            knows which of the three they are should not have to read a page to
            find their way in. */}
        <section className="section">
          <div className="wrap stack stack-5">
            <div className="reveal">
              <SectionHead
                eyebrow="Where you fit"
                title="Three ways in"
                lede="The same platform, seen from whichever side you are on."
              />
            </div>
            <div className="reveal">
              <div className="lp-paths">
                {PATHS.map((p) => (
                  <div className="lp-path" key={p.href}>
                    <p className="eyebrow">{p.eyebrow}</p>
                    <h3>
                      <Link href={p.href}>{p.title}</Link>
                    </h3>
                    <p>{p.body}</p>
                    <span className="go">{p.cta} →</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section lp-quiet">
          <div className="wrap stack stack-5">
            <div className="reveal">
              <SectionHead
                eyebrow="Two sides, one network"
                title="Six layers, one record underneath"
                lede="Each layer is worth something on its own. Together they are the reason a partner can recognise somebody they have never served before."
              />
            </div>
            <div className="reveal">
              <div className="lp-stack">
                {LAYERS.map((l) => (
                  <div className="lp-layer" key={l.name}>
                    <b>{l.name}</b>
                    <span>{l.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* The honesty section. Deliberately not buried at the bottom: on a page
            that has just made a series of confident claims, the paragraph
            listing what is *not* claimed is the one that earns the others. */}
        <section className="section">
          <div className="wrap stack stack-4">
            <div className="reveal">
              <SectionHead eyebrow="What this is, exactly" title="The claims we are not making." />
            </div>
            <div className="reveal">
              <div className="stack stack-4">
                <p className="lp-honest">
                  This is a working platform, not a finished company, and the difference is worth
                  being precise about. <strong>Payments run on a clearly-labelled sandbox
                  provider</strong> until real merchant credentials are configured. The whole path
                  is wired end to end — a checkout opens one provider order, and a payment is
                  captured only by a signed callback from the provider, never by anything the
                  browser reports — so what is missing is a merchant account, not code. On the
                  sandbox provider, no money moves.{' '}
                  <strong>Nothing here is powered by a language model.</strong> The planner is a
                  constraint solver over live inventory, the merchant advisor is arithmetic over
                  real transaction rows, and the demand forecast is a trailing mean that reports its
                  own sample size and stays quiet when it is too small to be useful. Where a figure
                  is an estimate, the screen says so and shows what it was computed from.
                </p>
                <p className="lp-honest">
                  We make no compliance claim we have not verified, and no availability claim we
                  have not tested. The verification API is open and rate-limited; the credential
                  signatures are Ed25519 over a hash of the claims, so a credential can be checked
                  without trusting our database.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
