'use client';

/**
 * Documentation search.
 *
 * A reference is only as good as the speed of getting to the one line you
 * need, and scrolling a long page looking for a field name is the thing that
 * makes people give up and read the source instead. So: a palette, opened with
 * ⌘K or /, filtering an index built on the server from the same catalogue the
 * pages render.
 *
 * The index is a prop rather than an import. `api-catalog.ts` computes example
 * dates at module load, and importing it into a client component would
 * recompute them in the reader's timezone — a hydration mismatch that would
 * appear as a React error on a page whose entire job is to look trustworthy.
 *
 * Matching is a substring scan over a pre-lowercased haystack. It is linear
 * over a list of a few hundred entries, which is nothing, and it is
 * predictable — fuzzy matching on a reference is worse than no matching,
 * because a developer who types an exact field name expects that field.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SearchEntry {
  /** What the reader sees. */
  title: string;
  /** Where it lives, shown on the right — "Webhooks", "Errors". */
  where: string;
  href: string;
  /** Extra words that should match: field names, error codes, event types. */
  terms?: string;
}

interface Indexed extends SearchEntry {
  haystack: string;
}

const MAX_RESULTS = 12;

export function DocsSearch({ entries }: { entries: SearchEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const index = useMemo<Indexed[]>(
    () =>
      entries.map((e) => ({
        ...e,
        haystack: `${e.title} ${e.where} ${e.terms ?? ''}`.toLowerCase(),
      })),
    [entries],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return index.slice(0, MAX_RESULTS);
    // Every whitespace-separated term must appear somewhere, so "post verify"
    // and "verify post" find the same thing.
    const terms = q.split(/\s+/);
    return index.filter((e) => terms.every((t) => e.haystack.includes(t))).slice(0, MAX_RESULTS);
  }, [index, query]);

  useEffect(() => setActive(0), [query]);

  /* Open on ⌘K / Ctrl-K, and on "/" when the reader is not already typing. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((was) => !was);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focused before the dialog is painted, so what is typed the moment it opens
  // lands in the field rather than on the page behind it (one animation frame
  // later, the first letters were lost). The field is emptied on close instead
  // of on open, so opening can never wipe what is already being typed.
  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);

  /* Keep the highlighted row in view when arrowing past the fold. */
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
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
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[active];
      if (chosen) go(chosen.href);
    }
  };

  return (
    <>
      <button type="button" className="docs-search" onClick={() => setOpen(true)}>
        <span aria-hidden="true">⌕</span>
        <span>Search the reference</span>
        <kbd aria-hidden="true">⌘K</kbd>
      </button>

      {open ? (
        <div
          className="palette-backdrop"
          /* Only a click that both starts and ends on the backdrop closes it —
             otherwise a drag that began inside the panel and released outside
             dismisses the dialog mid-selection. */
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="palette" role="dialog" aria-modal="true" aria-label="Search the reference">
            <input
              ref={inputRef}
              className="palette-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onFieldKey}
              placeholder="Endpoints, fields, events, error codes…"
              aria-label="Search the reference"
              autoComplete="off"
              spellCheck={false}
            />

            <div className="palette-results" ref={listRef}>
              {results.length === 0 ? (
                <p className="palette-empty">
                  Nothing matches <strong>{query}</strong>. The reference covers endpoints, webhook
                  events and error codes — everything else is in the architecture notes.
                </p>
              ) : (
                results.map((r, i) => (
                  <button
                    key={r.href + r.title}
                    type="button"
                    className="palette-item"
                    data-active={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.href)}
                  >
                    <span>{r.title}</span>
                    <span className="where">{r.where}</span>
                  </button>
                ))
              )}
            </div>

            <div className="palette-foot">
              <span>↑↓ to move</span>
              <span>↵ to open</span>
              <span>esc to close</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
