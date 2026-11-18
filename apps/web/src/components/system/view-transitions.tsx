'use client';

/**
 * Navigations that show what happened.
 *
 * The App Router swaps pages on the client, so the browser's own cross-document
 * view transitions never fire. This wraps a navigation in
 * `document.startViewTransition` by hand: the old page is captured, the router
 * navigates, and the transition finishes once the new path has rendered.
 * Anything carrying the same `view-transition-name` on both pages — the pass on
 * home and the pass opened, the bead under the current destination — travels
 * between its two positions instead of blinking.
 *
 * Where the API is missing, or the person prefers reduced motion, or the click
 * is a modified one (new tab, download), it is an ordinary link. The transition
 * is never allowed to hold a navigation hostage: if the new page has not
 * rendered within a second it is released regardless.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from 'react';

type Start = (href: string) => boolean;
const TransitionContext = createContext<Start | null>(null);

type DocumentWithTransitions = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> };
};

export function ViewTransitions({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    // The new path has committed: let the transition animate into it.
    pending.current?.();
    pending.current = null;
  }, [pathname]);

  const start = useCallback<Start>(
    (href) => {
      const doc = document as DocumentWithTransitions;
      if (!doc.startViewTransition) return false;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      if (document.documentElement.dataset.tier === 'lite') return false;
      const target = new URL(href, window.location.href);
      if (target.origin !== window.location.origin) return false;
      if (target.pathname === window.location.pathname) return false;

      doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            const release = () => resolve();
            pending.current = release;
            window.setTimeout(release, 1000);
            router.push(target.pathname + target.search + target.hash);
          }),
      );
      return true;
    },
    [router],
  );

  return <TransitionContext.Provider value={start}>{children}</TransitionContext.Provider>;
}

/** A `next/link` that navigates inside a view transition when one is available. */
export function TransitionLink({ onClick, href, ...rest }: ComponentProps<typeof Link>) {
  const start = useContext(TransitionContext);
  const target = typeof href === 'string' ? href : (href.pathname ?? '/');

  function handle(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || !start) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== '_self') return;
    if (start(target)) event.preventDefault();
  }

  return <Link href={href} onClick={handle} {...rest} />;
}
