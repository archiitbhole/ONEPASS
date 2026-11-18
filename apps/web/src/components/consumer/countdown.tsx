'use client';

/**
 * A live countdown to a deadline.
 *
 * The deadline arrives as an ISO string from the server, and the first render uses
 * the server's own `secondsRemaining` so the markup that hydrates matches the markup
 * that was sent — computing `Date.now()` during render instead would produce a
 * different number on the client and a hydration mismatch on every card.
 */
import { useEffect, useState } from 'react';

function format(seconds: number): string {
  if (seconds <= 0) return 'Ended';
  const d = Math.floor(seconds / 86_400);
  if (d >= 1) return `${d}d ${Math.floor((seconds % 86_400) / 3600)}h left`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h >= 1) return `${h}h ${String(m).padStart(2, '0')}m left`;
  if (m >= 1) return `${m}m ${String(s).padStart(2, '0')}s left`;
  return `${s}s left`;
}

export function Countdown({
  endsAt,
  secondsRemaining,
  className = 'badge badge-warn',
}: {
  endsAt: string;
  /** The server's figure, used for the first paint. */
  secondsRemaining: number;
  className?: string;
}) {
  const [seconds, setSeconds] = useState(secondsRemaining);

  useEffect(() => {
    const deadline = new Date(endsAt).getTime();
    const tick = () => setSeconds(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const urgent = seconds > 0 && seconds < 3600;

  return (
    <span
      className={seconds <= 0 ? 'badge badge-neutral' : urgent ? 'badge badge-bad' : className}
      role="timer"
      aria-live="off"
    >
      <span className="dot" aria-hidden="true" />
      {format(seconds)}
    </span>
  );
}
