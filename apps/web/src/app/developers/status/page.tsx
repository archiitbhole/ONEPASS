/**
 * What is built — the whole registry, on one page, for the audience most
 * damaged by getting this wrong.
 *
 * A developer who builds a quarter's roadmap around a capability that turns out
 * to be a button with nothing behind it has lost a quarter. So the feature
 * registry — which is checked against the repository rather than written from
 * memory — is published in full rather than filtered down to the flattering
 * rows, including for the consumer and partner surfaces a developer does not
 * control but does have to integrate around.
 *
 * `NEEDS_CONFIG` is the row that repays attention: built and tested, and inert
 * until this particular deployment is given a credential. That is the
 * difference between "this works" and "this works once somebody pays for an
 * account", and it is exactly the difference a demo hides.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusChip } from '@/components/system';
import { FEATURES, FEATURE_STATUS, featuresFor, type Feature } from '@/lib/features';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'What is built',
  description:
    `Every ${BRAND.name} capability and its real status — live, beta, pilot, needs configuration, or planned — read from the registry the application itself uses.`,
};

const AUDIENCES: { id: Feature['audience']; name: string; blurb: string }[] = [
  {
    id: 'developer',
    name: 'Developer platform',
    blurb: 'What you can call, and what you cannot call yet.',
  },
  {
    id: 'partner',
    name: 'Business console',
    blurb: 'What a merchant can do in the product your integration sits beside.',
  },
  {
    id: 'consumer',
    name: 'Consumer app',
    blurb: 'What a cardholder can do, which shapes what your events describe.',
  },
  {
    id: 'platform',
    name: 'Platform operations',
    blurb: 'What the people running the deployment have — including what they do not.',
  },
];

function FeatureTable({ audience }: { audience: Feature['audience'] }) {
  const rows = featuresFor(audience);
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Capability</th>
            <th scope="col">Status</th>
            <th scope="col">Detail</th>
            <th scope="col">Blocked on</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.key}>
              <td>{f.name}</td>
              <td>
                <StatusChip status={f.status} />
              </td>
              <td className="muted">{f.note ?? '—'}</td>
              <td className="muted">{f.blockedOn ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StatusPage() {
  const counts = new Map<string, number>();
  for (const f of FEATURES) counts.set(f.status, (counts.get(f.status) ?? 0) + 1);

  return (
    <>
      <section className="stack stack-4">
        <p className="eyebrow">How it works</p>
        <h1 className="display h1">What is built</h1>
        <p className="lede">
          {FEATURES.length} capabilities, each with the status the code actually supports. This is
          the same registry the application reads to decide what a screen is allowed to claim, so it
          cannot flatter itself on this page and hedge on another.
        </p>
      </section>

      <section className="card stack stack-4">
        <h2 className="h3">What the words mean</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Count</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(FEATURE_STATUS).map(([status, meta]) => (
                <tr key={status}>
                  <td>
                    <StatusChip status={status as Feature['status']} />
                  </td>
                  <td className="table-num">{counts.get(status) ?? 0}</td>
                  <td className="muted">{meta.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          <strong>Needs setup</strong> is the one worth reading closely. Those capabilities are
          implemented and tested; they are inert until this deployment is given a credential it does
          not currently hold. A demo that quietly substitutes a fake for the missing provider looks
          identical right up until real money or a real message is involved.
        </p>
      </section>

      {AUDIENCES.map((a) => (
        <section key={a.id} className="card stack stack-4">
          <div className="stack stack-2">
            <h2 className="h3 anchored">{a.name}</h2>
            <p className="muted">{a.blurb}</p>
          </div>
          <FeatureTable audience={a.id} />
        </section>
      ))}

      <section className="card stack stack-3">
        <h2 className="h3">The architectural limits are on their own page</h2>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          This page is about capabilities. The constraints that are properties of the design rather
          than of an unbuilt feature — no scheduler, one environment, the partner API needing a
          session — are in the <Link href="/developers/architecture#limits">system reference</Link>.
        </p>
      </section>
    </>
  );
}
