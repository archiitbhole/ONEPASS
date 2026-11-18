/**
 * The shape the door console passes between the server action and the browser.
 *
 * It lives in its own module because a `'use server'` file may export nothing but
 * async functions, and both sides need the initial value — the client to seed
 * `useActionState`, the action to describe what it returns.
 */
import type { AdmitResult } from '@/lib/commerce/tickets';

export interface DoorState {
  /** 'idle' before the first submission, so the console renders no verdict at all. */
  phase: 'idle' | 'result' | 'error';
  /** Straight from `admitTicket` — its reason and message are shown verbatim. */
  result: AdmitResult | null;
  error: string | null;
  presented: string | null;
  /** ISO instant of the attempt, so two identical scans still read as two scans. */
  at: string | null;
}

export const IDLE_DOOR_STATE: DoorState = {
  phase: 'idle',
  result: null,
  error: null,
  presented: null,
  at: null,
};
