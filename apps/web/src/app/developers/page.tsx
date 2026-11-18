/**
 * The developer overview.
 *
 * The job of this page is to get somebody from "what is this" to a working call
 * in under a minute, and to be honest about the shape of the platform before
 * they build on it rather than after. Two things a reader needs to know
 * immediately and would otherwise discover the hard way:
 *
 *  · verification is genuinely open, and genuinely checkable without us;
 *  · the partner API is session-authenticated today, so it is not yet something
 *    a backend can call.
 *
 * Both are said here, on the first screen, rather than buried in a note.
 */
import Link from 'next/link';
import { Code } from '@/components/developers/code';
import { Signature } from '@/components/developers/endpoint';
import { StatusChip } from '@/components/system';
import { ENDPOINTS, EXAMPLE_ISSUED, endpoint } from '@/lib/api-catalog';
import { featuresFor } from '@/lib/features';
import { appHost } from './host';
import { BRAND } from '@/lib/brand';

export default async function DevelopersOverview() {
  const host = await appHost();
  const verify = endpoint('verify')!;

  return (
    <>
      <section className="stack stack-4">
        <p className="eyebrow">Developers</p>
        <h1 className="display h1">Check a credential from your own systems</h1>
        <p className="lede">
          One endpoint answers the only question that matters: is this credential real, is it still
          valid, and who issued it. It is open — an employer checking a degree has no {BRAND.name}{' '}
          account and should not need one.
        </p>
        <div className="row-wrap">
          <Link className="btn btn-primary" href="/developers/verify">
            Make your first call
          </Link>
          <Link className="btn" href="/developers/api">
            Full API reference
          </Link>
        </div>
      </section>

      <section className="card stack stack-4">
        <div className="endpoint-head">
          <Signature endpoint={verify} />
          <StatusChip status="LIVE" />
        </div>
        <Code language="plain" label="Copy curl">
          {`curl -X POST ${host}/api/v1/verify \\
  -H 'content-type: application/json' \\
  -d '{"reference":"cred_8ej1g185p9"}'`}
        </Code>
        <p className="muted">
          No key, no signup, no SDK. Every resolved verdict is a{' '}
          <span className="mono">200</span> — including <span className="mono">REVOKED</span> and{' '}
          <span className="mono">NOT_FOUND</span>. Branch on{' '}
          <span className="mono">outcome</span>, never on the status code.
        </p>
      </section>

      <section className="stack stack-4">
        <h2 className="h2 anchored">Three things worth knowing before you build</h2>
        <div className="grid grid-3">
          <article className="card stack stack-3 fill-height">
            <h3 className="h4">You do not have to trust us</h3>
            <p className="muted">
              Every credential carries an Ed25519 signature over a SHA-256 hash of its canonical
              claims, and both the proof and the issuer&rsquo;s public key are on the response. If
              you trust the issuer but not our database, check it yourself — a credential stays
              checkable after the holder has moved on and after we are out of the loop.
            </p>
            <p className="push-end">
              <Link href="/developers/verify#proof">How to check the proof →</Link>
            </p>
          </article>

          <article className="card stack stack-3 fill-height">
            <h3 className="h4">The partner API is a console API today</h3>
            <p className="muted">
              Issuing, keys and webhooks are authenticated by session cookie and a same-origin
              check, not by a bearer token. That means they work from the business console and{' '}
              <strong>not</strong> from your backend. The scopes exist and keys can be granted them;
              the routes do not read keys yet.
            </p>
            <p className="push-end">
              <Link href="/developers/status">What is built, honestly →</Link>
            </p>
          </article>

          <article className="card stack stack-3 fill-height">
            <h3 className="h4">Events come two ways</h3>
            <p className="muted">
              Server-sent events for a signed-in browser, signed webhooks for your servers. Both are
              fed by the same transactional outbox, so an event cannot describe a write that then
              rolled back — and cannot be lost because a socket was closed at the wrong moment.
            </p>
            <p className="push-end">
              <Link href="/developers/webhooks">Webhook reference →</Link>
            </p>
          </article>
        </div>
      </section>

      <section className="card stack stack-4">
        <h2 className="h3 anchored">Everything, on one screen</h2>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col">Path</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className={`method method-${e.method.toLowerCase()}`}>{e.method}</span>
                  </td>
                  <td>
                    <Link className="sig-path" href={`/developers/api#${e.id}`}>
                      {e.path}
                    </Link>
                  </td>
                  <td>{e.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Sample responses on the reference carry dates relative to today —{' '}
          <span className="mono">{EXAMPLE_ISSUED}</span> in the examples is three days ago — so a
          one-year validity window still reads as one year however long this page has been up.
        </p>
      </section>

      <section className="card stack stack-4">
        <h2 className="h3 anchored">What exists, and what does not</h2>
        <p className="muted">
          Read from the feature registry, which is checked against the repository rather than
          written from memory. Nothing below is aspiration.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Status</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {featuresFor('developer').map((f) => (
                <tr key={f.key}>
                  <td>{f.name}</td>
                  <td>
                    <StatusChip status={f.status} />
                  </td>
                  <td className="muted">{f.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
