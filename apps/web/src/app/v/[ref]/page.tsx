/**
 * The public verification page — what a QR scan lands on.
 *
 * The single screen the whole product is for. Its constraints are unusual and
 * they drive every decision here:
 *
 *  · It must work signed out. An employer checking a degree has no ONEPASS
 *    account and should not need one; requiring a login would make the
 *    credential useless to the only person who needs to trust it.
 *  · It must work on a bad connection. So it is a server component with no
 *    client JavaScript at all — the verdict is in the first byte of HTML.
 *  · The verdict must be readable in a doorway, at arm's length, by someone who
 *    is not technical. Hence one enormous word, one sentence, then the detail.
 *  · It must never overstate. A verified signature means the issuer signed these
 *    claims; it does not mean the underlying document is legally authentic, and
 *    the page says so rather than letting a green tick imply it.
 *
 * The checks are listed even when everything passed, because a verifier who can
 * see *what* was checked can decide whether it was enough. A bare tick asks for
 * trust; a list earns it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { verifyCredential, type Outcome, type VerificationResult } from '@/lib/credentials/service';
import { getActor } from '@/lib/authz/authorize';
import { Brand, formatDate, Icon } from '@/components/ui';
import { BRAND } from '@/lib/brand';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ref: string }>;
}): Promise<Metadata> {
  const { ref } = await params;
  return {
    title: `Verification ${ref}`,
    // A verification result is about a named person. It has no business in a
    // search index, and a link shared onward should not preview their details.
    robots: { index: false, follow: false, nocache: true },
  };
}

const VERDICT: Record<Outcome, { word: string; tone: 'ok' | 'warn' | 'bad'; icon: 'check' | 'alert' | 'cross' }> = {
  VERIFIED: { word: 'Verified', tone: 'ok', icon: 'check' },
  PENDING: { word: 'Not yet valid', tone: 'warn', icon: 'alert' },
  EXPIRED: { word: 'Expired', tone: 'warn', icon: 'alert' },
  REVOKED: { word: 'Revoked', tone: 'bad', icon: 'cross' },
  INVALID: { word: 'Invalid', tone: 'bad', icon: 'cross' },
  NOT_FOUND: { word: 'Not found', tone: 'bad', icon: 'cross' },
};


/**
 * A verifier's own check, in full.
 *
 * Printed on the page rather than linked because the point of publishing a
 * proof is that somebody can act on it without going anywhere else. It uses
 * only `node:crypto`, so it runs with no network and no install — which is what
 * "offline verification" has to mean if it is going to mean anything.
 */
const OFFLINE_SNIPPET = `import { createHash, createPublicKey, verify } from 'node:crypto';

// Everything below comes from this page (or GET /api/v1/credentials/<ref>).
const claims    = { /* the claims, exactly as published */ };
const publicKey = '<issuer public key, base64>';
const signature = '<signature, base64>';

// 1. Rebuild the canonical bytes: keys sorted, serialised as [key, value] pairs.
const canonical = JSON.stringify(
  Object.keys(claims).sort().map((k) => [k, claims[k]])
);

// 2. Hash them. This must equal the published claims hash.
const claimsHash = createHash('sha256').update(canonical, 'utf8').digest();

// 3. Check the issuer's signature over that hash.
const ok = verify(
  null,
  claimsHash,
  createPublicKey({
    key: Buffer.from(publicKey, 'base64'),
    format: 'der',
    type: 'spki',
  }),
  Buffer.from(signature, 'base64')
);

console.log(ok ? 'signature valid' : 'signature does NOT match');`;

/** Turn `graduation_year` into `Graduation year` without inventing a dictionary. */
function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function claimValue(value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return formatDate(d);
  }
  return String(value);
}

function Verdict({ result }: { result: VerificationResult }) {
  const v = VERDICT[result.outcome];
  return (
    <div className={`verdict verdict-${v.tone}`}>
      <div className="verdict-mark">
        {v.icon === 'check' ? Icon.check(34) : v.icon === 'alert' ? Icon.alert(34) : Icon.cross(34)}
      </div>
      {/*
        The verdict is the page's `h1`.

        It used to be a paragraph, and the page had no `h1` at all — which the
        structural audit found. The heading of a verification result is the
        result: "Valid", "Not valid". Anything above it would be furniture
        pretending to be the subject.
      */}
      <h1 className="verdict-title">{v.word}</h1>
      <p className="small" style={{ marginTop: 8, maxWidth: '44ch', marginInline: 'auto' }}>
        {result.summary}
      </p>
    </div>
  );
}

export default async function VerificationPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;

  const head = await headers();
  const actor = await getActor().catch(() => null);

  // The scan IS the verification: opening this page records a check, exactly as
  // POSTing to /api/v1/verify would. That is what powers the issuer's "who is
  // checking these?" view, and it is why the page cannot be statically cached.
  const result = await verifyCredential({
    presentedRef: ref,
    channel: 'public',
    verifierUserId: actor?.userId ?? null,
    requestId: head.get('x-request-id'),
    ip: head.get('x-forwarded-for'),
  });

  const cred = result.credential;

  return (
    <div className="vp">

      <header className="topbar">
        <div className="wrap topbar-inner">
          <Brand />
          <Link className="navlink" href="/verify">
            Check another
          </Link>
        </div>
      </header>

      <main id="main" className="vp-main">
        <div className="wrap-narrow stack stack-5">
          <Verdict result={result} />

          {cred ? (
            <>
              <div className="card">
                <div className="vp-issuer">
                  <div className="vp-issuer-mark" aria-hidden="true">
                    {cred.issuer.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="grow">
                    <p className="eyebrow">Issued by</p>
                    <p style={{ fontWeight: 600 }}>{cred.issuer.name}</p>
                  </div>
                  {cred.issuer.verified ? (
                    <span className="badge badge-ok">
                      {Icon.shield(13)} Active issuer
                    </span>
                  ) : (
                    <span className="badge badge-warn">Issuer not active</span>
                  )}
                </div>
              </div>

              <div className="card">
                <p className="eyebrow">{cred.type.name}</p>
                {cred.holderName ? (
                  <p className="h2" style={{ marginTop: 4, marginBottom: 14 }}>{cred.holderName}</p>
                ) : (
                  <p className="small muted" style={{ marginTop: 4, marginBottom: 14 }}>
                    This credential type does not disclose the holder&rsquo;s name.
                  </p>
                )}

                <dl className="vp-claims">
                  {Object.entries(cred.claims).map(([key, value]) => (
                    <div className="vp-claim" key={key}>
                      <dt>{humanise(key)}</dt>
                      <dd>{claimValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="card">
                <p className="eyebrow" style={{ marginBottom: 10 }}>What was checked</p>
                <div className="checklist">
                  {result.checks.map((check, i) => (
                    <div className="checkline" key={i}>
                      <span className={`checkmark checkmark-${check.ok ? 'ok' : 'bad'}`}>
                        {check.ok ? Icon.check(16) : Icon.cross(16)}
                      </span>
                      <span className="grow">
                        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{check.label}</span>
                        <span className="tiny muted" style={{ display: 'block' }}>
                          {check.detail}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <p className="eyebrow" style={{ marginBottom: 10 }}>Details</p>
                <dl className="dl">
                  <div>
                    <dt>Reference</dt>
                    <dd className="mono">{cred.reference}</dd>
                  </div>
                  <div>
                    <dt>Issued</dt>
                    <dd>{formatDate(cred.issuedAt)}</dd>
                  </div>
                  <div>
                    <dt>Valid from</dt>
                    <dd>{formatDate(cred.validFrom)}</dd>
                  </div>
                  <div>
                    <dt>Valid until</dt>
                    <dd>{cred.validUntil ? formatDate(cred.validUntil) : 'No expiry'}</dd>
                  </div>
                  {cred.revocation ? (
                    <div>
                      <dt>Revoked</dt>
                      <dd>
                        {formatDate(cred.revocation.revokedAt)} —{' '}
                        {cred.revocation.reason.replace(/_/g, ' ').toLowerCase()}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              {cred.issuer.publicKey ? (
                <details className="card">
                  <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13.5 }}>
                    Verify this yourself
                  </summary>
                  <div className="stack stack-3" style={{ marginTop: 14 }}>
                    <p className="small muted">
                      The issuer signed a SHA-256 hash of these claims with an Ed25519 key. You do
                      not have to trust {BRAND.name}&rsquo;s answer — with the issuer&rsquo;s public key
                      below you can check the signature independently.
                    </p>
                    <div>
                      <p className="eyebrow">Issuer public key (base64, SPKI DER)</p>
                      <p className="vp-key">{cred.issuer.publicKey}</p>
                    </div>
                    <div>
                      <p className="eyebrow">Signature (base64, Ed25519)</p>
                      <p className="vp-key">{cred.proof.signature}</p>
                    </div>
                    <div>
                      <p className="eyebrow">Claims hash (SHA-256, hex)</p>
                      <p className="vp-key">{cred.proof.claimsHash}</p>
                    </div>
                    <div>
                      <p className="eyebrow">Machine-readable result</p>
                      <p className="vp-key">GET /api/v1/credentials/{cred.reference}</p>
                    </div>
                    <div>
                      <p className="eyebrow">Check it offline</p>
                      <p className="small muted" style={{ marginBottom: 8 }}>
                        Node 18 or later, no network and no dependencies. The claims are
                        canonicalised by sorting the keys and serialising them as
                        <span className="mono"> [key, value] </span> pairs — two machines have to
                        agree byte for byte on what was signed, so insertion order cannot be
                        allowed to matter.
                      </p>
                      <pre className="code-block">{OFFLINE_SNIPPET}</pre>
                    </div>
                  </div>
                </details>
              ) : null}
            </>
          ) : (
            <div className="card">
              <p className="small muted">
                No credential matches that reference. References are random rather than sequential,
                so a mistyped character will not land on someone else&rsquo;s — check the code and
                scan again.
              </p>
            </div>
          )}

          {/* The limit of the claim. A green tick must not be allowed to imply
              more than the cryptography actually establishes. */}
          <div className="notice">
            <span className="checkmark" aria-hidden="true">{Icon.shield(15)}</span>
            <span>
              <strong>What this does and does not prove.</strong> A verified result means the named
              issuer cryptographically signed these exact claims, that the signature still matches,
              and that the credential has not been revoked or expired. It is not a judgement about
              any underlying document, and {BRAND.name} makes no independent claim of legal authenticity.
            </span>
          </div>

          <p className="tiny muted" style={{ textAlign: 'center' }}>
            This check has been recorded and is visible to the issuer.
          </p>
        </div>
      </main>

      <footer className="footer">
        <div className="wrap row-between">
          <span>{BRAND.name} verification</span>
          <Link href="/verify">Check another credential</Link>
        </div>
      </footer>
    </div>
  );
}
