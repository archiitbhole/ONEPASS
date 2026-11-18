/**
 * Where a flight booking has got to, drawn from the state machine itself.
 *
 * Five stations, because five things have to happen and each one can fail in
 * its own way: a fare is chosen, the airline is asked what it costs *now*, the
 * money moves, the airline confirms a seat, and a ticket is issued. Collapsing
 * the middle three into "processing" is exactly how somebody is told the wrong
 * thing at the worst moment — `PAYMENT_FAILED` (no money, no seat) and
 * `BOOKING_FAILED` (money taken, no seat) land on different stations here and
 * always will.
 *
 * The mapping is a table rather than a chain of conditionals, for the same
 * reason `booking-state.ts` is: a rule spread over five call sites is a rule
 * with five places to forget it. If a state is added to the machine, this
 * object stops type-checking until somebody says where it belongs.
 *
 * `CANCELLED` and `REFUNDED` deliberately return `null`. A cancelled booking
 * did not "reach station two of five" — it stopped, and a progress bar that
 * implies otherwise is a progress bar that reads as hope.
 */
import type { StepState } from '@/components/ui';
import type { BookingState } from '@/lib/travel/booking-state';

export const BOOKING_STAGES = [
  'Fare chosen',
  'Price re-checked',
  'Paid',
  'Confirmed by the airline',
  'Ticketed',
] as const;

/**
 * How far each state has got, and what is happening at the station it is at.
 * `done` is the number of stations completed; `mark` applies to the next one.
 */
const POSITION: Record<BookingState, { done: number; mark: 'current' | 'failed' | null; detail?: string }> = {
  OFFER_SELECTED: { done: 1, mark: 'current', detail: 'ask the airline' },
  REVALIDATING: { done: 1, mark: 'current', detail: 'asking' },
  PRICE_CHANGED: { done: 1, mark: 'current', detail: 'the price moved — your decision' },
  REVALIDATION_FAILED: { done: 1, mark: 'failed', detail: 'the fare is gone' },
  PRICE_CONFIRMED: { done: 2, mark: 'current' },
  PAYMENT_PENDING: { done: 2, mark: 'current', detail: 'awaiting the payment provider' },
  PAYMENT_FAILED: { done: 2, mark: 'failed', detail: 'nothing was charged' },
  PAYMENT_AUTHORIZED: { done: 3, mark: 'current', detail: 'money taken, airline not answered' },
  BOOKING_PENDING: { done: 3, mark: 'current', detail: 'booking with the airline' },
  BOOKING_FAILED: { done: 3, mark: 'failed', detail: 'charged, no seat — a refund is owed' },
  CONFIRMED: { done: 4, mark: 'current', detail: 'ticket usually within minutes' },
  TICKETED: { done: 5, mark: null },
  // Stopped rather than progressed. Handled by the caller.
  CANCELLED: { done: 0, mark: null },
  REFUNDED: { done: 0, mark: null },
};

export interface ProgressStep {
  label: string;
  state: StepState;
  detail?: string;
}

/**
 * The steps for `<Steps>`, or null for a booking that stopped.
 *
 * Confirmed timestamps are passed in rather than looked up, because this file
 * has no database in it and a component that queries is a component that cannot
 * be rendered from a test.
 */
export function bookingSteps(
  state: BookingState,
  details: { revalidatedAt?: Date | null; confirmedAt?: Date | null; ticketedAt?: Date | null } = {},
  format: (at: Date) => string = (at) => at.toISOString(),
): ProgressStep[] | null {
  if (state === 'CANCELLED' || state === 'REFUNDED') return null;

  const position = POSITION[state];
  const stamped: (string | undefined)[] = [
    undefined,
    details.revalidatedAt ? format(details.revalidatedAt) : undefined,
    undefined,
    details.confirmedAt ? format(details.confirmedAt) : undefined,
    details.ticketedAt ? format(details.ticketedAt) : undefined,
  ];

  return BOOKING_STAGES.map((label, index) => {
    if (index < position.done) return { label, state: 'done' as StepState, detail: stamped[index] };
    if (index === position.done && position.mark) {
      return { label, state: position.mark as StepState, detail: position.detail };
    }
    return { label, state: 'todo' as StepState };
  });
}
