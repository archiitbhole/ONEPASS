/**
 * The authentication shell.
 *
 * On a phone, one column: the brand, the form, a way back. Nothing else — this
 * is where a person types a password, and every extra element is either a
 * distraction or something a phishing page would also copy. The trust cue is
 * the address bar and the brand, not decoration.
 *
 * On a desktop the other half of the screen is the object the account is for:
 * a pass on night stock, drawn, with no name on it but "Your name", and three
 * sentences that are true of every account. It is a stage, not a form, and it
 * carries no link and no field.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/ui';
import { Guilloche, Pass } from '@/components/objects';
import { BRAND, titleTemplate } from '@/lib/brand';

export const metadata: Metadata = {
  title: { default: 'Sign in', template: titleTemplate() },
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell" data-surface="public">
      <div className="auth-side">
        <header>
          <Brand href="/" />
        </header>
        <main id="main" className="auth-form">
          <div className="auth-card">{children}</div>
        </main>
        <footer className="auth-foot">
          <Link href="/">Back to {BRAND.name}</Link>
          <Link href="/verify">Verify a credential</Link>
          <Link href="/developers">Developers</Link>
        </footer>
      </div>

      <aside className="auth-scene immersive" aria-hidden="true">
        <Guilloche pattern="field" />
        <div className="auth-scene-inner">
          <div className="auth-scene-pass">
            <Pass seed="auth-scene">
              <Pass.Top status="Active" />
              <Pass.Chip />
              <Pass.Holder name="Your name" meta="Holder" />
            </Pass>
          </div>
          <ul className="auth-scene-points">
            <li>
              <strong>One pass</strong> at every partner — hotels, cinemas, restaurants, shops, flights.
            </li>
            <li>
              <strong>Your consent</strong> decides what a business sees, and you can see what they saw.
            </li>
            <li>
              <strong>A code that rotates</strong>, so a photograph of it is useless a minute later.
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
