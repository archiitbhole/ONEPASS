/**
 * Types shared by the deal form and the server actions behind it.
 *
 * Separate module because a `'use server'` file may export only async functions,
 * and both halves need these shapes.
 */
export interface PricePreview {
  ok: boolean;
  /** What the slot normally sells for. Read from the slot, never from the form. */
  listPriceMinor: number | null;
  /** What `computePrice` produces for the rule as typed. */
  priceMinor: number | null;
  savedMinor: number;
  currency: string;
  /** Why the rule cannot be priced, in the same words the service would use. */
  message: string | null;
}

export const EMPTY_PREVIEW: PricePreview = {
  ok: false,
  listPriceMinor: null,
  priceMinor: null,
  savedMinor: 0,
  currency: 'INR',
  message: null,
};

export interface DealFormState {
  phase: 'idle' | 'error';
  message: string | null;
  /** Field name → message, for the one field that caused it where we know which. */
  field: string | null;
}

export const IDLE_DEAL_STATE: DealFormState = { phase: 'idle', message: null, field: null };

export interface SlotOption {
  slotId: string;
  label: string;
  venueName: string;
  /** Formatted server-side so the option text is stable between server and client. */
  when: string;
  available: number;
  capacity: number;
  listPriceMinor: number;
  currency: string;
}
