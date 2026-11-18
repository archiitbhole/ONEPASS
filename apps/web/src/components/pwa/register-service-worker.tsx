'use client';

/**
 * Registers the service worker, and only for the consumer app.
 *
 * Where it is mounted is the whole design decision. ONEPASS on a phone is a
 * thing people hold up at a counter, so it is worth installing to a home screen
 * and worth having answer instantly on a bad connection. The partner and admin
 * consoles are desktop tools operated on a working connection, and a cache in
 * front of them would only create a way for staff to act on a stale figure — so
 * this component is mounted in the consumer layout and nowhere else.
 *
 * Registration waits for `load`. A service worker install competes for exactly
 * the bandwidth the first screen needs, and the person looking at the screen
 * has not asked for the second visit to be fast at the cost of this one.
 *
 * Renders nothing, and fails quietly: an unavailable service worker (an
 * insecure origin, a private window, a browser that does not have one) is a
 * missing optimisation, not a broken app.
 */
import { useEffect } from 'react';

export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Nothing to tell the user: they lose offline support, not the app.
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
