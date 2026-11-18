'use client';

/**
 * Copy this ticket to the device as it is opened.
 *
 * Mounted on the ticket page, renders nothing, and writes one small record so
 * `/offline` can show the ticket in a basement with no signal. See
 * `lib/offline/tickets.ts` for why this is a deliberate copy rather than a
 * cache, and why it is tickets and never the pass.
 *
 * It runs on open rather than behind a "save for offline" button on purpose. A
 * person who is about to need a ticket offline is a person who just looked at
 * it; asking them to predict the basement is asking them to fail.
 */
import { useEffect } from 'react';
import { keepTicket, type KeptTicket } from '@/lib/offline/tickets';

export function KeepTicketOffline(ticket: Omit<KeptTicket, 'keptAt'>) {
  const { reference, title, place, seatLabel, admitCount, validFrom, validUntil, state } = ticket;

  useEffect(() => {
    keepTicket({ reference, title, place, seatLabel, admitCount, validFrom, validUntil, state });
    // Primitives in the dependency list rather than the object, which is a new
    // identity on every render and would rewrite the store on each one.
  }, [reference, title, place, seatLabel, admitCount, validFrom, validUntil, state]);

  return null;
}
