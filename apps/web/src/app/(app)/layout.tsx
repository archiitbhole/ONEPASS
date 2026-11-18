/**
 * The consumer shell.
 *
 * A phone first, meant literally: five destinations in a floating dock within
 * thumb reach, the pass at its centre, and only on a desktop's worth of room a
 * spacious bar with the destinations written out. The layout is where the
 * session is checked, so no page below it has to remember — an
 * unauthenticated request never reaches a screen that would render somebody's
 * tickets.
 *
 * Everything here is a server component except the three things that need the
 * browser: which destination is current (the navs), the command palette, and
 * the view transitions that make moving between them read as moving.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, count, eq, isNull } from 'drizzle-orm';
import { Brand, Monogram } from '@/components/ui';
import { Glyph } from '@/components/icons';
import { ConsumerDeskNav, ConsumerDock } from '@/components/consumer/nav';
import { CommandSearch } from '@/components/consumer/command-search';
import { RegisterServiceWorker } from '@/components/pwa/register-service-worker';
import { TransitionLink, ViewTransitions } from '@/components/system/view-transitions';
import { getActor } from '@/lib/authz/authorize';
import { titleTemplate, BRAND } from '@/lib/brand';
import { db } from '@/db/client';
import { notifications } from '@/db/schema';

export const metadata: Metadata = {
  title: { default: BRAND.name, template: titleTemplate() },
};

export default async function ConsumerLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  // The one place the consumer app checks. A page below this cannot forget to.
  if (!actor) redirect('/sign-in');

  // The bell's number, counted rather than guessed: a badge that says three
  // when there are none is a badge people learn to ignore.
  const [unread] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));
  const unreadCount = unread?.n ?? 0;

  return (
    // `data-surface` sets the register — accent temperature, ambience,
    // density. Consumer is the warmest and most spacious. See tokens.css.
    <div className="shell" data-surface="consumer">
      <div className="ambient ambient-drift" aria-hidden="true" />
      <ViewTransitions>
        <header className="appbar">
          <div className="wrap appbar-inner">
            <Brand href="/home" />
            <ConsumerDeskNav />
            <div className="appbar-actions">
              {/* Thirty-odd screens and five places in the dock. This is how a
                  person reaches the rest, and finds one of their own tickets
                  without knowing which screen lists it. On every screen, phone
                  included. */}
              <CommandSearch />
              <TransitionLink href="/pass" className="btn btn-sm appbar-pass" aria-label="Show my pass">
                <Glyph name="pass" size={18} />
                <span>Pass</span>
              </TransitionLink>
              <Link
                className="bar-button"
                href="/notifications"
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              >
                <Glyph name="bell" size={22} />
                {unreadCount > 0 ? (
                  <span className="bar-count" aria-hidden="true">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                ) : null}
              </Link>
              <Link
                className="bar-button bar-avatar"
                href="/profile"
                aria-label={`Profile — signed in as ${actor.displayName}`}
                title={actor.displayName}
              >
                <Monogram name={actor.displayName} size={32} />
              </Link>
            </div>
          </div>
        </header>

        <main id="main" className="app-main">
          {children}
        </main>

        <div className="dock-spacer" aria-hidden="true" />
        <ConsumerDock />
      </ViewTransitions>
      <RegisterServiceWorker />
    </div>
  );
}
