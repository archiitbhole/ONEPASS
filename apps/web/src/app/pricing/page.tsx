/**
 * Pricing.
 *
 * Linked from the landing header and footer since the landing page was written,
 * and a 404 until now.
 *
 * The honesty problem this page has: ONEPASS has never charged anyone. Every
 * number below is what we intend to charge, not what anyone has paid, and a page
 * that implied otherwise would be the same lie as a fake testimonial. So the
 * figures are labelled as proposed, the pilot terms say plainly that pricing is
 * open during it, and each line names the column that meters it — a revenue
 * model with nowhere to record it is a slide rather than a plan.
 *
 * The structure follows who pays: a person never does, a partner pays on revenue
 * we introduced, and a verifier pays per check.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/ui';
import { BRAND } from '@/lib/brand';
import { SiteFooter } from '@/components/site/chrome';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    `What ${BRAND.name} costs: free for people, commission on revenue we introduce for partners, and per-check pricing for the verification API.`,
};

interface Plan {
  name: string;
  who: string;
  price: string;
  unit: string;
  points: string[];
  featured?: boolean;
}

const PLANS: Plan[] = [
  {
    name: 'People',
    who: `Anyone with a ${BRAND.name}`,
    price: 'Free',
    unit: 'always',
    points: [
      'Your pass, tickets, receipts, warranties and points',
      'Consent controls, with one tap to withdraw',
      'No advertising, and no selling of personal data — ever',
      'Deals are funded by partners, never by a subscription',
    ],
  },
  {
    name: 'Partners',
    who: 'Venues, merchants and issuers',
    price: 'Commission',
    unit: `on revenue ${BRAND.name} introduces`,
    featured: true,
    points: [
      'The full business console: capacity, deals, door, insights, demand',
      'Charged only on a sale an offer introduced — never on your own repeat trade',
      'Cross-brand points settle at the issuing partner’s own rate',
      'No setup fee and no minimum term during the pilot',
    ],
  },
  {
    name: 'Verification API',
    who: 'Employers, landlords, platforms',
    price: 'Per check',
    unit: 'metered daily, billed monthly',
    points: [
      'One call returns the verdict, the checks behind it and the issuer’s public key',
      'A generous free tier so an integration can be built and tested at no cost',
      'Signature verification works offline — you are not billed to trust us',
      'Usage is visible to you and to the issuer, per key and per endpoint',
    ],
  },
];

const METERING: { stream: string; metered: string; why: string }[] = [
  {
    stream: 'Transaction commission',
    metered: 'bookings.amount_minor, where an offer introduced the sale',
    why: 'The seat was going to expire unsold. A share of revenue that did not exist before is not a cost.',
  },
  {
    stream: 'Verification API',
    metered: 'api_usage — daily buckets per key and per endpoint',
    why: 'A verifier pays per check rather than building an integration with every issuer separately.',
  },
  {
    stream: 'City pass',
    metered: 'city_pass_entitlements.settlement_minor, per use',
    why: 'The partner is paid per redemption. It is distribution, not a discount they absorb.',
  },
  {
    stream: 'Cross-brand settlement',
    metered: 'reward_programs.settlement_paise_per_point',
    why: 'The issuer is paid when their points are honoured elsewhere. Nobody gives away another business’s margin.',
  },
  {
    stream: 'Consented reach',
    metered: 'campaigns.cost_per_delivery_minor',
    why: 'Reaches people who opted in, with a k-anonymity floor so an audience can never be narrowed to a person.',
  },
];

export default function PricingPage() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Brand />
          <nav className="navlinks" aria-label="Main">
            <Link className="navlink navlink-secondary" href="/verify">Verify</Link>
            <Link className="navlink navlink-secondary" href="/developers">Developers</Link>
            <Link className="btn btn-sm btn-primary" href="/sign-in">Sign in</Link>
          </nav>
        </div>
      </header>

      <main id="main" className="section">
        <div className="wrap stack stack-6">
          <div className="stack stack-3" style={{ maxWidth: '62ch' }}>
            <p className="eyebrow">Pricing</p>
            <h1 className="display h1">Free for people. Partners pay on revenue we introduce.</h1>
            <p className="lede">
              A person never pays for their own identity. A partner pays a share of a sale that
              would not have happened, and a verifier pays for the check it would otherwise have to
              build itself.
            </p>
          </div>

          <div className="notice notice-warn">
            <span>
              <strong>Pricing is proposed, not tested.</strong> No {BRAND.name} partner has paid us
              anything — we are running a pilot, and rates are agreed with each partner during it.
              Treat every figure on this page as an intention rather than a rate card, because that
              is what it is.
            </span>
          </div>

          <div className="grid grid-3">
            {PLANS.map((plan) => (
              <div key={plan.name} className={plan.featured ? 'card card-lift stack stack-4' : 'card stack stack-4'}>
                <div className="stack stack-2">
                  <p className="eyebrow">{plan.who}</p>
                  <h2 className="h3">{plan.name}</h2>
                </div>
                <div>
                  <span className="display" style={{ fontSize: 30 }}>{plan.price}</span>
                  <p className="small muted" style={{ marginTop: 4 }}>{plan.unit}</p>
                </div>
                <ul className="stack stack-2">
                  {plan.points.map((point) => (
                    <li key={point} className="small">{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <section className="card stack stack-4">
            <div className="stack stack-2">
              <h2 className="h3">What each stream is metered by</h2>
              <p className="muted small">
                Each line names the column that records it. A revenue model with nowhere to write it
                down is a slide, not a plan.
              </p>
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr><th>Stream</th><th>Metered by</th><th>Why the payer agrees</th></tr>
                </thead>
                <tbody>
                  {METERING.map((row) => (
                    <tr key={row.stream}>
                      <td><strong>{row.stream}</strong></td>
                      <td className="mono small">{row.metered}</td>
                      <td>{row.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card stack stack-3">
            <h2 className="h3">What is not charged for</h2>
            <p className="muted">
              Consumers, always. Verifying a credential from the{' '}
              <Link href="/verify">public page</Link>, always — an employer checking a degree should
              not need an account, let alone an invoice. And checking an Ed25519 signature yourself,
              which needs nothing from us at all.
            </p>
          </section>

          <section className="card stack stack-3">
            <h2 className="h3">Talk to us about a pilot</h2>
            <p className="muted">
              Partner onboarding is manual while the pilot runs, which is deliberate — the first
              partners in a network are worth talking to properly.{' '}
              <Link href="/sign-up">Create an account</Link> and the console will walk you through
              registering an organization, or read the{' '}
              <Link href="/developers">API documentation</Link> first.
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
