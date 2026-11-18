/**
 * What the counter console passes between its server actions and the browser.
 *
 * Its own module because a `'use server'` file may export nothing but async
 * functions, and both sides need these shapes — the client to seed
 * `useActionState`, the actions to describe what they return.
 *
 * The console is a sequence of four states and the state itself says which one
 * it is in, rather than the component inferring it from which fields happen to
 * be filled. Reading `phase` is how someone new to this file learns the flow.
 */
import type { CheckLine } from '@/lib/pass/service';

/** One row of the sale, exactly as the form collected it. Strings: it came from a form. */
export interface DraftLine {
  description: string;
  sku: string;
  quantity: string;
  /** Rupees, as typed. Converted to whole paise once, in the action. */
  unitPrice: string;
  /** Percent, as typed — a shopkeeper thinks in 18, not in 1800 basis points. */
  taxPercent: string;
  warrantyMonths: string;
  serialNumber: string;
  returnable: boolean;
}

export interface SaleDraft {
  lines: DraftLine[];
  discount: string;
  paymentLabel: string;
  merchantReceiptNo: string;
  gstin: string;
  venueId: string;
  returnWindowDays: string;
  returnPolicyNote: string;
}

/** The figures the receipt service computed. Never computed in the browser. */
export interface DraftTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: { position: number; lineTotalMinor: number; discountShareMinor: number; taxMinor: number }[];
}

export interface CounterBuyerView {
  customerRef: string;
  displayName: string | null;
  /** ISO instant of the scan, so the console can show the window running down. */
  presentedAt: string;
}

export interface IssuedView {
  publicRef: string;
  totalMinor: number;
  taxMinor: number;
  currency: string;
  warrantiesIssued: number;
  returnWindowDays: number;
  customerRef: string;
}

export interface CounterState {
  /**
   * `identify` — waiting for a pass.
   * `compose` — a pass was accepted; the basket is being rung up.
   * `review`  — the service has priced the basket and is waiting for a yes.
   * `issued`  — the receipt exists.
   */
  phase: 'identify' | 'compose' | 'review' | 'issued';
  /** Present from `compose` onwards. The authorisation the sale cites. */
  presentationId: string | null;
  buyer: CounterBuyerView | null;
  /** The verification's own lines, shown once so staff can see what was checked. */
  checks: CheckLine[];
  /** Kept across `review` so a correction returns to a filled form, not a blank one. */
  draft: SaleDraft | null;
  totals: DraftTotals | null;
  issued: IssuedView | null;
  /** A refusal, in the service's own words. Never rephrased here. */
  error: string | null;
  /** ISO instant of the attempt, so two identical submissions still read as two. */
  at: string | null;
}

export const EMPTY_LINE: DraftLine = {
  description: '',
  sku: '',
  quantity: '1',
  unitPrice: '',
  taxPercent: '18',
  warrantyMonths: '',
  serialNumber: '',
  returnable: true,
};

export const IDLE_COUNTER_STATE: CounterState = {
  phase: 'identify',
  presentationId: null,
  buyer: null,
  checks: [],
  draft: null,
  totals: null,
  issued: null,
  error: null,
  at: null,
};
