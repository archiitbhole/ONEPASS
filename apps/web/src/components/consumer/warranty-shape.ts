/**
 * How a warranty reads: how much of its term is gone, and what to call that.
 *
 * Pure functions, no JSX. The shelf, the wallet and the detail screen all draw
 * the same bar and all label it the same way, and they do that because the
 * arithmetic lives here rather than being re-derived on each screen — three
 * copies of "how far through is this" is three chances to round a lapse a day
 * early.
 *
 * Both dates are read at midnight in India, on the same basis `addMonths` used
 * to set the expiry. Reading them in UTC would move a boundary by five and a
 * half hours and lapse a warranty on the wrong calendar day.
 */
import { EXPIRING_SOON_DAYS } from '@/lib/commerce/warranties';
import { daysUntilIsoDate } from './format';

export interface WarrantyTerm {
  /** Calendar days left; negative once it has lapsed. */
  days: number;
  lapsed: boolean;
  /** Inside the same window the reminder sweep calls "soon". */
  expiringSoon: boolean;
  /** 0–100, clamped. How much of the cover has been used. */
  percentUsed: number;
  tone: 'ok' | 'warn' | 'neutral';
  /** The badge word: "142 days left", "Lapses today", "Lapsed 3 weeks ago". */
  label: string;
}

export function warrantyTerm(
  warranty: { purchasedOn: string; expiresOn: string },
  now: Date,
  describe: (days: number) => string,
): WarrantyTerm {
  const days = daysUntilIsoDate(warranty.expiresOn, now);
  const lapsed = days < 0;
  const expiringSoon = !lapsed && days <= EXPIRING_SOON_DAYS;

  const purchased = new Date(`${warranty.purchasedOn}T00:00:00+05:30`).getTime();
  const expires = new Date(`${warranty.expiresOn}T00:00:00+05:30`).getTime();
  // A one-day floor rather than a guard: a same-day term is real (a merchant
  // can write one) and dividing by its zero length is not.
  const term = Math.max(1, expires - purchased);
  const elapsed = Math.min(term, Math.max(0, now.getTime() - purchased));

  return {
    days,
    lapsed,
    expiringSoon,
    percentUsed: Math.round((elapsed / term) * 100),
    tone: lapsed ? 'neutral' : expiringSoon ? 'warn' : 'ok',
    label: lapsed ? `Lapsed ${describe(days)}` : days === 0 ? 'Lapses today' : `${days} days left`,
  };
}
