'use client';

/**
 * The inbox list.
 *
 * Client for two capabilities and no more: marking things read without losing
 * your place, and fetching the next page when you ask for it. The first page is
 * rendered on the server and handed in — so the list is on screen before any
 * JavaScript runs, and someone with none still reads every notification they
 * have; only the two buttons stop working.
 *
 * Marking read goes through `POST /api/me/notifications`, which takes a list of
 * ids and updates only the caller's own rows. Afterwards the page is refreshed
 * rather than patched locally alone, because the count on the shell's bell is
 * rendered by the layout — and a badge that still says three after you have read
 * all three is the reason nobody trusts a badge.
 *
 * Nothing here decides what a notification says. Title, body and category are
 * the row's own; the only judgement this file makes is whether the stored
 * `linkPath` is a safe relative path, and `safeLinkPath` makes it.
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Empty, Notice, formatDateTime, formatRelative } from '@/components/ui';
import { Glyph } from '@/components/icons';
import { categoryShape, dayHeading, dayKey, safeLinkPath } from './notification-shape';

export interface InboxItem {
  id: string;
  category: string;
  title: string;
  body: string;
  linkPath: string | null;
  /** ISO, or null while unread. */
  readAt: string | null;
  createdAt: string;
}

interface Envelope {
  error?: { code?: string; message?: string; requestId?: string };
}

export function NotificationInbox({
  initialItems,
  initialCursor,
  unreadOnly,
  renderedAt,
  emptyTitle,
  emptyBody,
}: {
  initialItems: InboxItem[];
  initialCursor: string | null;
  unreadOnly: boolean;
  /**
   * The server's clock at render time, ISO.
   *
   * "2 hours ago" and "Today" are both answers to *when is now*, and the server
   * and the browser do not agree about that to the millisecond. Deriving them
   * from `Date.now()` inside a component the server also renders is a hydration
   * mismatch — React discards the whole tree and redraws it, which is a real
   * flash on a real phone. So the server states its now once and both renders
   * use it.
   */
  renderedAt: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  const router = useRouter();
  const now = useMemo(() => new Date(renderedAt), [renderedAt]);
  const [older, setOlder] = useState<InboxItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [readLocally, setReadLocally] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'idle' | 'marking' | 'loading'>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // The server page can be re-rendered under us by `router.refresh()`, and a
  // page fetched by the button below can overlap it. Keyed by id so the same
  // notification can never appear twice.
  const items = useMemo(() => {
    const byId = new Map<string, InboxItem>();
    for (const item of [...initialItems, ...older]) byId.set(item.id, item);
    return [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }, [initialItems, older]);

  const isRead = (item: InboxItem) => Boolean(item.readAt) || readLocally.has(item.id);
  const unreadOnScreen = items.filter((item) => !isRead(item));

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setBusy('marking');
    setFailure(null);
    try {
      const res = await fetch('/api/me/notifications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ids.slice(0, 100) }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as Envelope;
        setFailure(parsed.error?.message ?? `The server refused that with HTTP ${res.status}.`);
        return;
      }
      setReadLocally((current) => {
        const next = new Set(current);
        for (const id of ids) next.add(id);
        return next;
      });
      // The bell's count lives in the layout, so the whole route has to re-render.
      startTransition(() => router.refresh());
    } catch (err) {
      setFailure(`That did not reach the server — ${err instanceof Error ? err.message : 'the network failed'}.`);
    } finally {
      setBusy('idle');
    }
  }

  async function loadOlder() {
    if (!cursor) return;
    setBusy('loading');
    setFailure(null);
    try {
      const query = new URLSearchParams({ cursor, limit: '25', ...(unreadOnly ? { unread: 'true' } : {}) });
      const res = await fetch(`/api/me/notifications?${query.toString()}`, { credentials: 'same-origin' });
      if (!res.ok) {
        const parsed = (await res.json().catch(() => ({}))) as Envelope;
        setFailure(parsed.error?.message ?? `The server refused that with HTTP ${res.status}.`);
        return;
      }
      const page = (await res.json()) as { items: InboxItem[]; nextCursor: string | null };
      setOlder((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setFailure(`That did not reach the server — ${err instanceof Error ? err.message : 'the network failed'}.`);
    } finally {
      setBusy('idle');
    }
  }

  if (items.length === 0) {
    return (
      <Card>
        <Empty title={emptyTitle} body={emptyBody} />
      </Card>
    );
  }

  // Grouped in the order they already arrive in — newest first — so a day's
  // heading is written once, where that day starts.
  const days: { key: string; items: InboxItem[] }[] = [];
  for (const item of items) {
    const key = dayKey(new Date(item.createdAt));
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(item);
    else days.push({ key, items: [item] });
  }

  return (
    <div className="stack stack-5">
      <div className="row-between inbox-bar">
        <p className="small muted" aria-live="polite">
          {unreadOnScreen.length > 0
            ? `${unreadOnScreen.length} unread on this page.`
            : 'Everything on this page has been read.'}
        </p>
        <Button
          size="sm"
          onClick={() => void markRead(unreadOnScreen.map((item) => item.id))}
          disabled={unreadOnScreen.length === 0 || busy === 'marking'}
        >
          {busy === 'marking' ? 'Marking…' : 'Mark all shown as read'}
        </Button>
      </div>

      {failure ? (
        <Notice tone="bad">
          <span role="alert">{failure}</span>
        </Notice>
      ) : null}

      {days.map((day) => (
        <section key={day.key} className="stack stack-3" aria-labelledby={`day-${day.key}`}>
          <h2 id={`day-${day.key}`} className="eyebrow">
            {dayHeading(day.key, now)}
          </h2>
          <ul className="inbox">
            {day.items.map((item) => {
              const shape = categoryShape(item.category);
              const href = safeLinkPath(item.linkPath);
              const read = isRead(item);

              return (
                <li key={item.id} className="inbox-item" data-read={read ? 'true' : undefined}>
                  <span className={`inbox-mark inbox-mark-${shape.tone}`} aria-hidden="true">
                    <Glyph name={shape.glyph} size={16} />
                  </span>

                  <div className="inbox-body">
                    <p className="inbox-title">
                      {href ? <Link href={href}>{item.title}</Link> : item.title}
                      {read ? null : <span className="sr-only"> — unread</span>}
                    </p>
                    <p className="small">{item.body}</p>
                    <p className="tiny muted">
                      {shape.label} · <time dateTime={item.createdAt}>{formatDateTime(new Date(item.createdAt))}</time>{' '}
                      · {formatRelative(new Date(item.createdAt), now)}
                    </p>
                  </div>

                  <div className="inbox-side">
                    {read ? (
                      <span className="tiny muted">Read</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void markRead([item.id])}
                        disabled={busy === 'marking'}
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {cursor ? (
        <div className="row-wrap">
          <Button onClick={() => void loadOlder()} disabled={busy === 'loading'}>
            {busy === 'loading' ? 'Loading…' : 'Load older'}
          </Button>
          <span className="tiny muted">Twenty-five at a time, oldest of these first.</span>
        </div>
      ) : (
        <p className="tiny muted">That is everything on this account.</p>
      )}
    </div>
  );
}
