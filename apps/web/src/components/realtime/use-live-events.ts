'use client';

/**
 * The client half of the event stream.
 *
 * ONEPASS has had the whole server side of this since the first schema — a
 * transactional outbox, a Redis fan-out, and an SSE endpoint that authorises
 * channels from the session. What it never had was a subscriber. `/api/events/stream`
 * ran, authenticated, held Redis subscriptions and delivered to nobody, so every
 * screen in the product was a static render you had to reload: a door scan did not
 * appear on the merchant's dashboard, a confirmed booking did not appear on the
 * ticket list, and a security finding sat in the database until someone pressed F5.
 *
 * This hook is that subscriber. It is deliberately small: it does not hold a cache,
 * mirror server state, or try to patch rows into a page. It reports that something
 * of a given type happened, and the caller decides what to do — which for a
 * server-rendered application is almost always `router.refresh()`, letting the
 * server recompute the page it already knows how to compute. Duplicating that
 * derivation on the client is how two sources of truth get born.
 */
import { useEffect, useRef } from 'react';

/** Everything the stream sends, as `sseFrame` writes it. */
export interface LiveEvent {
  id: string;
  type: string;
  channel: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface UseLiveEventsOptions {
  /** Event types to react to. Anything else on the stream is ignored. */
  types: readonly string[];
  /** Called for each matching event, already coalesced by the caller if needed. */
  onEvent: (event: LiveEvent) => void;
  /** Set false to hold the connection closed — a screen behind a tab, say. */
  enabled?: boolean;
}

export function useLiveEvents({ types, onEvent, enabled = true }: UseLiveEventsOptions): void {
  // Both are refs so that a caller passing an inline arrow function or array
  // literal — which every caller does — cannot tear down and rebuild the
  // EventSource on every render. The connection outlives the render; the
  // behaviour is read fresh each time an event arrives.
  const handler = useRef(onEvent);
  const wanted = useRef(types);
  handler.current = onEvent;
  wanted.current = types;

  useEffect(() => {
    if (!enabled) return;
    // Server render, or a browser without EventSource: the page is already
    // correct as delivered, it simply will not update on its own.
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const source = new EventSource('/api/events/stream');

    const listener = (raw: MessageEvent<string>) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(raw.data) as LiveEvent;
      } catch {
        // A frame we cannot parse is a frame we ignore. It is not worth breaking
        // a live screen over, and the server log is where a malformed event
        // belongs.
        return;
      }
      handler.current(event);
    };

    // Named listeners rather than `onmessage`: the server sets `event:` to the
    // domain type, and a named SSE event never arrives on the default handler.
    const attached = [...wanted.current];
    for (const type of attached) source.addEventListener(type, listener as EventListener);

    return () => {
      for (const type of attached) source.removeEventListener(type, listener as EventListener);
      source.close();
    };
    // `types` is intentionally not a dependency — see the refs above. Changing the
    // set of interesting types on a mounted screen is not a thing any caller does,
    // and making it one would reconnect the stream on every render.
  }, [enabled]);
}
