'use client';

/**
 * The command palette.
 *
 * Thirty-three screens and a seven-item tab bar. The gap between those two numbers
 * is what this component closes: type two letters and get the screen, or the
 * ticket, or the receipt, wherever you are in the app.
 *
 * **Two sources, deliberately asymmetric.** Screen names are matched in the
 * browser against the list in `places.ts` — it is a few dozen entries, the match is a
 * substring scan, and it is instant, which is what makes the palette feel like
 * navigation rather than a search engine. A person's own records cannot be
 * matched in the browser, so those come from `/api/me/search` after a pause in
 * typing. Local results appear immediately and the remote ones join them; the
 * list never blanks while a request is in flight, because a palette that
 * flickers is a palette people stop trusting.
 *
 * **Fuzzy matching is deliberately absent.** Somebody who types "savings" wants
 * Savings, and a scorer that decides "Bookings" is a 0.62 match for it is worse
 * than nothing. Every whitespace-separated term has to appear somewhere in the
 * row's text, so "air quality" and "quality air" find the same screen and
 * "qulaity" finds nothing — which at least tells the truth.
 *
 * **The dialog is portalled to `document.body`, and has to be.** This component
 * is mounted in the topbar, and the topbar carries a `backdrop-filter`. A filter
 * makes an element the containing block for every fixed-position descendant, so
 * `position: fixed; inset: 0` rendered in place resolves against a 60px-tall
 * header rather than the viewport: the overlay lands across the page content,
 * the rows sit over the article behind them, and clicking one hits whatever is
 * on top. The same trap already caught the tab bar, which is a sibling of the
 * header for exactly this reason.
 *
 * **It is a combobox, spelled the way the pattern is written.** The input owns
 * the focus and `aria-activedescendant` moves the selection; the rows are
 * `option`s rather than buttons, so a screen reader announces "3 of 12" instead
 * of reading a wall of buttons. Escape closes, focus returns to the trigger, and
 * nothing behind the dialog is reachable while it is open.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { PLACES, type Place } from './places';
import { BRAND } from '@/lib/brand';

interface Row {
  key: string;
  title: string;
  detail: string | null;
  where: string;
  href: string;
}

interface RemoteHit {
  title: string;
  detail: string | null;
  where: string;
  href: string;
}

const MAX_PLACES = 8;
const MAX_REMOTE = 10;
/** Long enough that a fast typist sends one request, short enough to feel live. */
const DEBOUNCE_MS = 220;
const MIN_REMOTE_QUERY = 2;

/** Pre-lowercased once, because this runs on every keystroke. */
interface IndexedPlace extends Place {
  haystack: string;
}

function matches(haystack: string, terms: string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}

export function CommandSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<RemoteHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const index = useMemo<IndexedPlace[]>(
    () =>
      PLACES.map((place) => ({
        ...place,
        haystack: `${place.label} ${place.where} ${place.keywords ?? ''} ${place.href}`.toLowerCase(),
      })),
    [],
  );

  const trimmed = query.trim();

  const places = useMemo<Row[]>(() => {
    const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    const found = terms.length === 0 ? index : index.filter((place) => matches(place.haystack, terms));
    return found.slice(0, MAX_PLACES).map((place) => ({
      key: `place:${place.href}`,
      title: place.label,
      detail: null,
      where: place.where,
      href: place.href,
    }));
  }, [index, trimmed]);

  const rows = useMemo<Row[]>(
    () => [
      ...places,
      ...remote.slice(0, MAX_REMOTE).map((hit, i) => ({
        key: `hit:${hit.href}:${i}`,
        title: hit.title,
        detail: hit.detail,
        where: hit.where,
        href: hit.href,
      })),
    ],
    [places, remote],
  );

  /* Ask the server for the person's own records, once typing settles. */
  useEffect(() => {
    if (!open || trimmed.length < MIN_REMOTE_QUERY) {
      setRemote([]);
      setSearching(false);
      setRemoteError(null);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/me/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          // A limiter or a session that expired mid-search. The screen names
          // still work, so the palette says what is missing and carries on.
          setRemote([]);
          setRemoteError(
            res.status === 429
              ? 'Searching your records is taking a break for a moment.'
              : 'Could not search your own records just now.',
          );
          return;
        }
        const body = (await res.json()) as { hits?: RemoteHit[] };
        setRemote(body.hits ?? []);
        setRemoteError(null);
      } catch (err) {
        // An aborted request is the next keystroke, not a failure.
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
        setRemote([]);
        setRemoteError('Could not search your own records just now.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, trimmed]);

  useEffect(() => setActive(0), [trimmed]);

  /* ⌘K and Ctrl-K anywhere; "/" when the person is not already typing. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((was) => !was);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /*
   * The field has focus before the dialog is painted, so whatever is typed the
   * moment it appears lands in the field. It used to be focused one animation
   * frame later, and "/" followed at once by "refund" sent the first letters to
   * the page behind — the browser suite caught it against a production build.
   */
  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /*
   * Closing resets the field — so opening never has to, and cannot wipe what is
   * already being typed — and hands focus back to what opened it.
   *
   * Only on a real close. This effect also runs on mount, when `open` is false,
   * and it used to move focus to the Search button on every page load: a
   * keyboard user's first Tab then skipped "Skip to content" and everything
   * before the header control, and a screen reader announced a button nobody
   * had asked for.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    setQuery('');
    setRemote([]);
    setRemoteError(null);
    triggerRef.current?.focus();
  }, [open]);

  /* Keep the highlighted row on screen when arrowing past the fold. */
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const onFieldKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (rows.length === 0 ? 0 : (i + 1) % rows.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (rows.length === 0 ? 0 : (i - 1 + rows.length) % rows.length));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, rows.length - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = rows[active];
      if (chosen) go(chosen.href);
    }
  };

  /**
   * Keep Tab inside the dialog.
   *
   * There are exactly two stops — the field and the close button — so the trap
   * is a wrap rather than a focus-order calculation. Without it, Tab walks into
   * the page behind an `aria-modal` dialog, which is the most common way a
   * palette fails a keyboard user.
   */
  const onPanelKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const stops = panelRef.current?.querySelectorAll<HTMLElement>('input, button');
    if (!stops || stops.length === 0) return;
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const activeRow = rows[active];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="op-search-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <span className="op-search-trigger-label">Search</span>
        {/* Hidden from assistive technology: a shortcut is not the control's
            name, and "Search ⌘K" is not what anybody wants read out. */}
        <kbd aria-hidden="true">⌘K</kbd>
      </button>

      {open
        ? createPortal(
            <div
              className="palette-backdrop"
              /* Only a press that starts and ends on the backdrop closes it, so a
                 drag that began inside the panel does not dismiss it. */
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <div
                ref={panelRef}
                className="palette"
                role="dialog"
                aria-modal="true"
                aria-label={`Search ${BRAND.name}`}
                onKeyDown={onPanelKey}
              >
                <div className="op-palette-head">
                  <input
                    ref={inputRef}
                    className="palette-input"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onFieldKey}
                    placeholder="Go to a screen, or find a ticket, receipt or trip…"
                    aria-label={`Search ${BRAND.name}`}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-activedescendant={activeRow ? optionId(active) : undefined}
                    aria-autocomplete="list"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="button" className="op-palette-close" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>

                <div className="palette-results" ref={listRef} role="listbox" id={listId} aria-label="Results">
                  {rows.length === 0 ? (
                    <p className="palette-empty">
                      Nothing matches <strong>{trimmed}</strong>. Screens are matched by name; your own
                      tickets, bookings, receipts, warranties and trips are matched by what is on them.
                    </p>
                  ) : (
                    rows.map((row, i) => (
                      <div
                        key={row.key}
                        id={optionId(i)}
                        role="option"
                        aria-selected={i === active}
                        className="palette-item"
                        data-active={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(row.href)}
                      >
                        <span className="op-palette-text">
                          <span>{row.title}</span>
                          {row.detail ? <span className="op-palette-detail">{row.detail}</span> : null}
                        </span>
                        <span className="where">{row.where}</span>
                      </div>
                    ))
                  )}
                </div>

                {/* One polite announcement rather than a chatty one per keystroke. */}
                <p className="sr-only" role="status">
                  {searching
                    ? 'Searching your records'
                    : `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`}
                </p>

                <div className="palette-foot">
                  {remoteError ? (
                    <span className="op-palette-warn">{remoteError}</span>
                  ) : (
                    <>
                      <span>↑↓ to move</span>
                      <span>↵ to open</span>
                      <span>esc to close</span>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
