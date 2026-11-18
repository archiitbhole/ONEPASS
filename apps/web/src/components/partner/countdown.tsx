/**
 * A ticking "ends in 12m 04s".
 *
 * Client-side because a countdown that does not count is a timestamp with extra
 * steps. The first render deliberately prints the value the server computed and
 * only starts ticking after mount — otherwise the server's second and the
 * browser's second disagree and React reports a hydration mismatch on every deal
 * in the list.
 */
'use client';

import { useEffect, useState } from 'react';
import { formatCountdown } from './time';

export function Countdown({
  endsAt,
  initial,
  endedLabel = 'ended',
}: {
  /** ISO-8601. Parsed once on mount; never trusted as a display string. */
  endsAt: string;
  /** What the server rendered, so hydration matches. */
  initial: string;
  endedLabel?: string;
}) {
  const [text, setText] = useState(initial);

  useEffect(() => {
    const target = new Date(endsAt).getTime();
    if (Number.isNaN(target)) return;

    const tick = () => {
      const remaining = target - Date.now();
      setText(remaining <= 0 ? endedLabel : formatCountdown(remaining));
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt, endedLabel]);

  return (
    <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </span>
  );
}
