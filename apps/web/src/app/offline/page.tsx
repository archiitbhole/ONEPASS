/**
 * The screen a failed navigation lands on.
 *
 * Deliberately outside `(app)`: it has no auth guard, reads nothing from the
 * database and renders nothing personal on the server, because the server is
 * not answering when this page matters. Everything on it comes from the device.
 *
 * That is also what makes it cacheable. The rest of the application is
 * `no-store` and rightly so; this page is the same bytes for everybody, so the
 * service worker precaches it at install and serves it when a navigation fails.
 * Before this existed the offline answer was a dead string built inside the
 * worker — honest, and useless to somebody standing at a cinema door.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/ui';
import { OfflineTickets } from '@/components/consumer/offline-tickets';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Offline',
  description: `What ${BRAND.name} can still show you with no connection.`,
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Brand href="/home" />
          <span className="small muted">Offline</span>
        </div>
      </header>

      <main id="main" className="section">
        <div className="wrap-narrow stack stack-6">
          <div className="stack stack-3">
            <p className="eyebrow">No connection</p>
            <h1 className="display h1">What you can still show</h1>
            <p className="lede">
              {BRAND.name} shows what is true right now, so most of it needs a network. Tickets are the
              exception: the code on one is a reference a door reads, not a secret, so a copy is
              kept on this device the first time you open it.
            </p>
          </div>

          <OfflineTickets />

          <p className="small muted">
            <Link href="/home">Try again</Link> — or keep this page open; it will say when you are
            back.
          </p>
        </div>
      </main>
    </div>
  );
}
