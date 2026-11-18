/**
 * The verifier's entry point.
 *
 * Someone holding a printed certificate, or a code they were emailed, needs a
 * box to type it into. A plain GET form, so it works with JavaScript disabled
 * and the result lands on a shareable URL.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand, Icon } from '@/components/ui';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Verify a credential',
  description:
    `Check any ${BRAND.name} credential. No account needed — enter the reference or scan the code.`,
};

async function verify(formData: FormData) {
  'use server';
  const ref = String(formData.get('reference') ?? '').trim();
  if (!ref) return;
  redirect(`/v/${encodeURIComponent(ref)}`);
}

export default function VerifyEntryPage() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Brand />
          <Link className="navlink" href="/">Home</Link>
        </div>
      </header>

      <main id="main" className="section">
        <div className="wrap-narrow stack stack-5">
          <div>
            <p className="eyebrow">Open to anyone</p>
            <h1 className="display h1">Check a credential</h1>
            <p className="lede" style={{ marginTop: 12 }}>
              No account, no sign-in. Enter the reference printed on the certificate or pass — or
              scan its code with your camera, which opens the same page.
            </p>
          </div>

          <form action={verify} className="card stack stack-4">
            <div className="field">
              <label className="label" htmlFor="reference">Credential reference</label>
              <input
                id="reference"
                name="reference"
                className="input input-mono"
                placeholder="crd_a1b2c3d4e5"
                autoFocus
                required
                maxLength={64}
              />
              <p className="hint">Usually starts with <code>crd_</code> and is about a dozen characters.</p>
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block">
              {Icon.scan(17)} Verify
            </button>
          </form>

          <div className="card">
            <p className="eyebrow" style={{ marginBottom: 10 }}>What you will see</p>
            <ul className="stack stack-2">
              <li className="small">Whether the issuer&rsquo;s signature over the claims still matches.</li>
              <li className="small">Whether the credential has been revoked, and when.</li>
              <li className="small">Whether it is inside its validity window.</li>
              <li className="small">Only what the credential asserts — never the holder&rsquo;s contact details.</li>
            </ul>
          </div>

          <div className="notice">
            <span>
              Building something? The same check is available as an API:{' '}
              <code>POST /api/v1/verify</code>. See <Link href="/developers">the developer docs</Link>.
            </span>
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="wrap">{BRAND.name} · verification is open and rate-limited</div>
      </footer>
    </div>
  );
}
