/**
 * Notifications — everything ONEPASS has told this person, newest first.
 *
 * The bell in the shell has always counted unread rows; until now there was
 * nowhere for it to lead. This is that place, and it is the same data the API
 * serves: `GET /api/me/notifications` pages it for the client, and this page
 * reads the first page from the database directly so the list is in the HTML
 * rather than arriving after a spinner.
 *
 * The filter is in the URL, not in state. `?unread=1` is a link, resolved on the
 * server, which means the filtered view is shareable, survives a reload, and
 * costs no JavaScript — the same reason `/explore` works the way it does.
 *
 * What this screen deliberately does not do is decide what anything says. A
 * notification is a record written inside the transaction that caused it; this
 * page groups those records by day and renders them. It never writes one, and
 * marking something read changes `read_at` and nothing else.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { notifications } from '@/db/schema';
import { ButtonLink, Card, Empty, PageHead, Stat } from '@/components/ui';
import { NotificationInbox, type InboxItem } from '@/components/consumer/notification-inbox';
import { currentActor } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Notifications',
  description: `Everything ${BRAND.name} has told you about your account, newest first.`,
};

export const dynamic = 'force-dynamic';

/** One screenful. The client asks for the next page with the cursor this leaves. */
const PAGE = 25;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ unread?: string }>;
}) {
  const actor = await currentActor();
  const params = await searchParams;
  // One clock for the server pass and the browser's hydration pass — see
  // `NotificationInbox`'s `renderedAt`.
  const renderedAt = new Date().toISOString();
  const unreadOnly = params.unread === '1';

  const owner = eq(notifications.userId, actor.userId);

  const [rows, [counts]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        category: notifications.category,
        title: notifications.title,
        body: notifications.body,
        linkPath: notifications.linkPath,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      // `id desc` rather than `created_at desc`: the ids are ULIDs, so they sort
      // in creation order anyway, and the cursor the API pages with is an id —
      // ordering by anything else would let a page skip a row.
      .where(unreadOnly ? and(owner, isNull(notifications.readAt)) : owner)
      .orderBy(desc(notifications.id))
      .limit(PAGE + 1),
    db
      .select({
        total: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where ${notifications.readAt} is null)::int`,
      })
      .from(notifications)
      .where(owner),
  ]);

  const page = rows.slice(0, PAGE);
  const nextCursor = rows.length > PAGE ? (page[page.length - 1]?.id ?? null) : null;

  const items: InboxItem[] = page.map((row) => ({
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));

  const total = counts?.total ?? 0;
  const unread = counts?.unread ?? 0;

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Your account"
        title="Notifications"
        lede={
          total === 0
            ? `Confirmations, receipts, security notices and anything a partner does with your consent land here.`
            : unread > 0
              ? `${unread} unread of ${total}.`
              : `${total} ${total === 1 ? 'notice' : 'notices'}, all read.`
        }
        actions={
          <ButtonLink href="/settings" size="sm" variant="ghost">
            What you are told about
          </ButtonLink>
        }
      />

      {total > 0 ? (
        <>
          <nav className="segmented" aria-label="Filter notifications">
            <Link className="segment" href="/notifications" aria-current={unreadOnly ? undefined : 'page'}>
              Everything
              <span className="count">{total}</span>
            </Link>
            <Link className="segment" href="/notifications?unread=1" aria-current={unreadOnly ? 'page' : undefined}>
              Unread
              <span className="count">{unread}</span>
            </Link>
          </nav>

          <NotificationInbox
            initialItems={items}
            initialCursor={nextCursor}
            unreadOnly={unreadOnly}
            renderedAt={renderedAt}
            emptyTitle={unreadOnly ? 'Nothing unread' : 'Nothing here yet'}
            emptyBody={
              unreadOnly
                ? 'You have read everything on this account.'
                : 'Notifications are written by whatever caused them, so an empty list means nothing has happened yet.'
            }
          />
        </>
      ) : (
        <Card>
          <Empty
            title="Nothing has happened yet"
            body={`A notification is written inside the transaction that caused it — a booking confirming, a receipt arriving, a business reading something you shared. Nothing on this account has done any of that.`}
            action={
              <ButtonLink href="/explore" variant="primary">
                Explore what is on
              </ButtonLink>
            }
          />
        </Card>
      )}

      <section aria-label="How notifications work" className="stat-row">
        <Stat
          label="Kept"
          value={total}
          tone="neutral"
          hint="Every notice stays as a record. Marking one read does not remove it."
        />
        <Stat
          label="Unread"
          value={unread}
          tone={unread > 0 ? 'accent' : 'neutral'}
          hint="This is the number the bell shows, counted from the same rows."
        />
        <Stat
          label="Security notices"
          value="Always on"
          tone="neutral"
          hint={
            <>
              They cannot be switched off — <Link href="/settings">see your preferences</Link>.
            </>
          }
        />
      </section>
    </div>
  );
}
