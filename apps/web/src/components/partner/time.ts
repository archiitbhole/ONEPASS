/**
 * Day boundaries, in the timezone the business actually trades in.
 *
 * "Today's revenue" is a claim about a merchant's trading day, not about UTC. A
 * console that buckets by the server's clock shows a Mumbai restaurant its
 * takings resetting at 05:30, which is the kind of number that quietly destroys
 * trust in every other figure on the page.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Midnight in Asia/Kolkata for the day `d` falls in, as a UTC instant. */
export function startOfBusinessDay(d: Date = new Date()): Date {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

/** `n` whole business days before the start of the day `d` falls in. */
export function startOfBusinessDaysAgo(n: number, d: Date = new Date()): Date {
  return new Date(startOfBusinessDay(d).getTime() - n * 86_400_000);
}

/** 'YYYY-MM-DD' for the Asia/Kolkata day `d` falls in. Matches the SQL buckets. */
export function businessDayKey(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** A short axis label — "5 Sep" — for a 'YYYY-MM-DD' bucket key. */
export function labelForDayKey(key: string): string {
  const [y, m, day] = key.split('-').map(Number);
  if (!y || !m || !day) return key;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, day)),
  );
}

/**
 * A `YYYY-MM-DDTHH:mm` value for `<input type="datetime-local">`, in IST.
 *
 * The input has no timezone of its own, so what is put in and what is read back
 * out have to agree on one — see `parseIstLocal` in the deal actions.
 */
export function toIstInputValue(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** "2h 14m", "48s" — the coarse form a countdown needs. Never negative. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}
