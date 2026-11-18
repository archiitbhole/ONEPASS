'use client';

/**
 * Keep a server-rendered screen current.
 *
 * Drop this on a page, name the events that would change what it shows, and the
 * page re-renders itself when one arrives. The refresh is the server's — the same
 * query, the same authorisation, the same consent filtering — so a live screen
 * cannot drift from a reloaded one, and no page state is duplicated in the client
 * to be got wrong later.
 *
 * Two behaviours worth knowing about:
 *
 *  · Bursts are coalesced. Twenty admissions in a second are one refresh, not
 *    twenty, because a door console at closing time should not DDoS its own
 *    database.
 *  · Nothing happens while the tab is hidden. A backgrounded dashboard that
 *    refreshes all afternoon is a battery and a bill; on return, one refresh
 *    catches it up, which is what the person wanted anyway.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveEvents } from './use-live-events';

/** Bursts inside this window collapse into a single refresh. */
const COALESCE_MS = 700;

export interface LiveRefreshProps {
  /** Event types that change what this screen shows. */
  types: readonly string[];
  /**
   * Noun for what arrived — "update", "finding". Rendered once at least one event
   * has, so a screen can say it moved rather than changing silently under the
   * reader.
   *
   * A string rather than a formatter function: this is a client component
   * rendered from server components, and a function cannot cross that boundary —
   * React refuses the render with "Functions cannot be passed directly to Client
   * Components", which is a 500 on a page that was previously fine.
   */
  noun?: string;
}

export function LiveRefresh({ types, noun }: LiveRefreshProps) {
  const router = useRouter();
  const [seen, setSeen] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVisibility = () => {
      const isHidden = document.visibilityState === 'hidden';
      setHidden(isHidden);
      // Coming back is itself a reason to refresh: whatever arrived while the tab
      // was in the background was not applied.
      if (!isHidden) router.refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [router]);

  const onEvent = useCallback(
    // The payload is deliberately unread. Every screen this sits on re-renders
    // from the server, so what arrived only has to say *that* something did —
    // reading the frame here would mean two descriptions of the same fact, and
    // the one on the wire is the one that can go stale.
    () => {
      setSeen((n) => n + 1);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, COALESCE_MS);
    },
    [router],
  );

  useLiveEvents({ types, onEvent, enabled: !hidden });

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!noun || seen === 0) return null;
  return (
    <span className="tiny muted" role="status" aria-live="polite">
      {seen} live {noun}
      {seen === 1 ? '' : 's'}
    </span>
  );
}
