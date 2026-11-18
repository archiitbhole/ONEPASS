/**
 * The words a consumer picks from when opening a return.
 *
 * `return_requests.reason_code` is free text of up to 60 characters — the service
 * accepts whatever a merchant integration sends — so this list is the app's own
 * vocabulary rather than a schema enum. It lives in one file because the form that
 * writes a code and the case list that reads one back have to agree; a label that
 * exists in only one of them shows up as a raw code on somebody's screen.
 *
 * `requestedResolution`, by contrast, *is* a schema enum, so the labels here are a
 * rendering of `return_resolution` and nothing more.
 */
import type { ReturnResolution } from '@/lib/commerce/returns';

export interface ReasonOption {
  code: string;
  label: string;
}

export const RETURN_REASONS: readonly ReasonOption[] = [
  { code: 'DAMAGED', label: 'Arrived damaged' },
  { code: 'DEFECTIVE', label: 'Faulty, or stopped working' },
  { code: 'WRONG_ITEM', label: 'Not the item I bought' },
  { code: 'NOT_AS_DESCRIBED', label: 'Not as described' },
  { code: 'SIZE_OR_FIT', label: 'Wrong size or fit' },
  { code: 'CHANGED_MIND', label: 'Changed my mind' },
  { code: 'OTHER', label: 'Something else' },
];

export function isReturnReason(code: string): boolean {
  return RETURN_REASONS.some((r) => r.code === code);
}

/** A code the app does not know is shown as itself rather than as a guess. */
export function labelReason(code: string): string {
  return RETURN_REASONS.find((r) => r.code === code)?.label ?? code.replace(/_/g, ' ').toLowerCase();
}

export const RESOLUTIONS: readonly { value: ReturnResolution; label: string; hint: string }[] = [
  { value: 'REFUND', label: 'Refund', hint: 'Money back to the way you paid.' },
  { value: 'REPLACEMENT', label: 'Replacement', hint: 'The same item again.' },
  { value: 'STORE_CREDIT', label: 'Store credit', hint: 'Credit with the merchant.' },
  { value: 'REPAIR', label: 'Repair', hint: 'The merchant fixes it.' },
];

export function labelResolution(value: string): string {
  return RESOLUTIONS.find((r) => r.value === value)?.label ?? value.replace(/_/g, ' ').toLowerCase();
}
