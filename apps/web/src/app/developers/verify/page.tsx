/**
 * The quickstart: one call, then the part that actually matters — checking the
 * proof without us.
 *
 * The independent-verification script is the most important thing on the whole
 * developer platform. Everything else documents an API; this documents the
 * claim the product is built on, and it is the one claim a reader can refuse to
 * take on trust. So it is runnable, it uses only the standard library, and it
 * is placed on the first page they land on rather than in an appendix.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Code } from '@/components/developers/code';
import { EndpointBlock } from '@/components/developers/endpoint';
import { endpoint } from '@/lib/api-catalog';
import { appHost } from '../host';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Verify a credential',
  description:
    `Make your first ${BRAND.name} call, read the verdict, and check the issuer signature yourself with twenty lines of standard-library code.`,
};

const OUTCOMES: { code: string; meaning: string }[] = [
  {
    code: 'VERIFIED',
    meaning:
      'Signature and hash check out, the issuer is a verified organization, and the credential is inside its validity window.',
  },
  { code: 'PENDING', meaning: 'Issued, but its validity has not started yet.' },
  { code: 'EXPIRED', meaning: 'It was valid and its window has closed.' },
  {
    code: 'REVOKED',
    meaning: 'The issuer withdrew it. The reason is on the response where the issuer gave one.',
  },
  {
    code: 'INVALID',
    meaning:
      'The claims do not match their hash, or the issuer signature does not verify. Treat this as a forgery, not an error.',
  },
  {
    code: 'NOT_FOUND',
    meaning:
      'No credential has that reference. A malformed reference returns this too, deliberately — so the endpoint cannot be used to tell a real reference from a guess.',
  },
];

const PROOF_SCRIPT = `import { createHash, createPublicKey, verify } from 'node:crypto';

// 1. Fetch the verdict. No key, no account.
const res = await fetch('HOST/api/v1/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ reference: 'cred_8ej1g185p9' }),
});
const { credential } = await res.json();
const { claims, proof, issuer } = credential;

// 2. Rebuild the exact bytes that were hashed. This is the whole trick, and
//    the only place an implementation can get it wrong: keys sorted, then
//    serialised as an array of [key, value] pairs with no extra whitespace.
//    That is what \`canonicalisation: "sorted-pairs-json"\` means.
const canonical = JSON.stringify(
  Object.keys(claims).sort().map((k) => [k, claims[k]]),
);

// 3. Hash them, and check that against the hash on the response. If these
//    differ, the claims you were shown are not the claims that were signed.
const recomputed = createHash('sha256').update(canonical, 'utf8').digest();
const hashMatches = recomputed.toString('hex') === proof.claimsHash;

// 4. Check the issuer's signature over that hash, with the issuer's own
//    public key. Ed25519 signs the message directly — the hash IS the
//    message here, so pass null as the algorithm.
const key = createPublicKey({
  key: Buffer.from(issuer.publicKey, 'base64'),
  format: 'der',
  type: 'spki',
});
const signatureValid = verify(
  null,
  recomputed,
  key,
  Buffer.from(proof.signature, 'base64'),
);

console.log({ hashMatches, signatureValid });
// Both true means this issuer produced exactly these claims — and you
// established that without trusting our database for anything but delivery.`;

export default async function VerifyQuickstart() {
  const host = await appHost();
  const verify = endpoint('verify')!;

  return (
    <>
      <section className="stack stack-4">
        <p className="eyebrow">Start here</p>
        <h1 className="display h1">Verify a credential</h1>
        <p className="lede">
          Two minutes to a working call, and ten more to stop needing us for it.
        </p>
      </section>

      <section className="card stack stack-4">
        <h2 className="h3 anchored">1 · Make the call</h2>
        <Code language="plain" label="Copy curl">
          {`curl -X POST ${host}/api/v1/verify \\
  -H 'content-type: application/json' \\
  -d '{"reference":"cred_8ej1g185p9"}'`}
        </Code>
        <p className="muted">
          The sample reference is the one used throughout this documentation. On a deployment that
          does not hold it you will get a <span className="mono">NOT_FOUND</span> verdict with a{' '}
          <span className="mono">200</span> — which is itself the first thing worth learning about
          this API. Use a reference from your own credentials to see a{' '}
          <span className="mono">VERIFIED</span>.
        </p>
      </section>

      <section className="card stack stack-4">
        <h2 className="h3 anchored">2 · Read the verdict, not the status code</h2>
        <p className="muted">
          Every resolved verdict is a <span className="mono">200</span>. The call succeeded; the
          answer is the point. Only a malformed request is a 4xx.
        </p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">outcome</th>
                <th scope="col">What it means</th>
              </tr>
            </thead>
            <tbody>
              {OUTCOMES.map((o) => (
                <tr key={o.code}>
                  <td className="mono">{o.code}</td>
                  <td>{o.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          An <span className="mono">INVALID</span> response still describes what was presented, so a
          human can see what was claimed. It is not an endorsement of it.
        </p>
      </section>

      <section id="proof" className="stack stack-4 anchored">
        <h2 className="h2">3 · Stop trusting us</h2>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          The response carries the issuer&rsquo;s signature, the claims hash, the canonicalisation
          rule, and the issuer&rsquo;s public key. That is everything needed to check the credential
          yourself — so &ldquo;verified&rdquo; stops being something we assert and becomes something
          you can confirm.
        </p>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          This matters most in the case nobody plans for: a credential still needs to be checkable
          after the holder has moved on, after the issuer has changed systems, and after we are no
          longer in the loop. Publishing the proof is what makes that true rather than reassuring.
        </p>

        <div className="card stack stack-3">
          <h3 className="h3">Twenty lines, no dependencies</h3>
          <Code language="plain" label="Copy script">
            {PROOF_SCRIPT.replace('HOST', host)}
          </Code>
        </div>

        <div className="card stack stack-3">
          <h3 className="h3">What this does and does not prove</h3>
          <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
            <li className="muted">
              <strong>It proves</strong> that the organization holding that private key signed
              exactly these claims. Change one character of one claim and the hash stops matching.
            </li>
            <li className="muted">
              <strong>It does not prove</strong> the credential is still valid. Revocation and
              expiry are state, not signature — a revoked credential&rsquo;s signature stays
              perfectly good forever. That is what the{' '}
              <span className="mono">outcome</span> field is for, and it is the one part you do
              still need a live call for.
            </li>
            <li className="muted">
              <strong>It does not prove</strong> the issuer is who they say they are. The public key
              is bound to an organization in our records; if you need more than that, pin the key
              you expect for an issuer you already know.
            </li>
          </ul>
        </div>
      </section>

      <section className="stack stack-4">
        <h2 className="h2 anchored">The endpoint, in full</h2>
        <EndpointBlock endpoint={verify} host={host} />
        <p className="muted">
          The GET form is on the <Link href="/developers/api#credential-by-ref">API reference</Link>
          , along with everything else.
        </p>
      </section>
    </>
  );
}
