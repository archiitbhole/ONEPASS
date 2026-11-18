/**
 * The endpoint explorer.
 *
 * Every endpoint in the catalogue, grouped, each with its own anchor so a link
 * into the middle of the reference lands on the thing it names. One page rather
 * than one page per endpoint: a reference is read by scanning and searching,
 * and a dozen navigations to compare two request shapes is worse than a scroll.
 *
 * Nothing here is written by hand. The signatures, parameters, examples, limits
 * and error lists all come from `api-catalog.ts`, which a test holds against
 * the routes themselves.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { EndpointBlock } from '@/components/developers/endpoint';
import { ENDPOINTS, GROUPS, endpointsIn } from '@/lib/api-catalog';
import { appHost } from '../host';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'API reference',
  description:
    `Every ${BRAND.name} endpoint: verification, issuing, API keys, webhooks and live events — with parameters, examples and the errors each can return.`,
};

export default async function ApiReference() {
  const host = await appHost();

  return (
    <>
      <section className="stack stack-4">
        <p className="eyebrow">Reference</p>
        <h1 className="display h1">API reference</h1>
        <p className="lede">
          {ENDPOINTS.length} documented endpoints. Authentication, rate limit and error list are
          shown on each, and every example is built against{' '}
          <span className="mono">{host}</span> — the host you are reading this on — so what you copy
          runs.
        </p>
      </section>

      <section className="card stack stack-3">
        <h2 className="h3">Conventions</h2>
        <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
          <li className="muted">
            Money is always an integer in minor units — <span className="mono">74000</span> is
            ₹740.00. There are no floating-point amounts anywhere in this API.
          </li>
          <li className="muted">
            Times are ISO-8601 with an offset. Anything describing a business day means{' '}
            <span className="mono">Asia/Kolkata</span>, including rate-limit and usage buckets.
          </li>
          <li className="muted">
            Identifiers come in two kinds: internal ULIDs, and random public references prefixed by
            type (<span className="mono">cred_</span>, <span className="mono">bkg_</span>,{' '}
            <span className="mono">tkt_</span>). Only the public ones are ever shown to a third
            party.
          </li>
          <li className="muted">
            Every response carries <span className="mono">x-request-id</span>. Log it — it is the
            single value that lets support find your exact call.
          </li>
          <li className="muted">
            Not yours and not there answer the same way, with a{' '}
            <Link href="/developers/errors#NOT_FOUND">404</Link>. That is deliberate: a 403 would
            confirm that the thing you asked about exists.
          </li>
        </ul>
      </section>

      {GROUPS.map((group) => (
        <section key={group.id} id={`group-${group.id}`} className="stack stack-5 anchored">
          <div className="stack stack-2">
            <h2 className="h2">{group.name}</h2>
            <p className="muted" style={{ maxWidth: '62ch' }}>
              {group.blurb}
            </p>
          </div>
          {endpointsIn(group.id).map((e) => (
            <EndpointBlock key={e.id} endpoint={e} host={host} />
          ))}
        </section>
      ))}
    </>
  );
}
