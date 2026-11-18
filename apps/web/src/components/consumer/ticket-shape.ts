/**
 * Which printed ticket a row is.
 *
 * The object's `kind` decides the band colour and the words on it, and the
 * band is the first thing read — so it is derived from the venue the ticket is
 * for, in one place, rather than guessed per screen. An unknown venue kind is
 * a venue ticket: the honest default, since every ticket here admits somebody
 * somewhere.
 */
import type { TicketKind, TicketState } from '@/components/objects';

export function ticketKindFor(venueKind: string | null | undefined): TicketKind {
  switch ((venueKind ?? '').toUpperCase()) {
    case 'CINEMA':
    case 'EVENT':
    case 'EVENTS':
      return 'event';
    case 'ATTRACTION':
      return 'city';
    default:
      return 'venue';
  }
}

/** The domain's ticket states, as the object draws them. */
export function ticketStateOf(state: string): TicketState {
  switch (state) {
    case 'ISSUED':
      return 'valid';
    case 'ADMITTED':
      return 'used';
    case 'VOID':
      return 'void';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'pending';
  }
}

/**
 * The words on the band.
 *
 * The band says what kind of thing this admits you to before a word of the
 * title is read, so it must not repeat the title — the venue's name belongs in
 * the fields, not twice at the top of the same object.
 */
export function ticketBandLabel(venueKind: string | null | undefined): string {
  switch ((venueKind ?? '').toUpperCase()) {
    case 'CINEMA':
      return 'Cinema ticket';
    case 'HOTEL':
      return 'Hotel stay';
    case 'RESTAURANT':
      return 'Table booking';
    case 'ATTRACTION':
      return 'Attraction pass';
    case 'EVENT':
    case 'EVENTS':
      return 'Event ticket';
    default:
      return 'Venue ticket';
  }
}

/** The stamp on the stub: one word, in the object's voice. */
export function ticketStampWord(state: string): { word: string; tone: 'ok' | 'bad' | 'neutral' | 'info' } {
  switch (state) {
    case 'ISSUED':
      return { word: 'Valid', tone: 'ok' };
    case 'ADMITTED':
      return { word: 'Admitted', tone: 'neutral' };
    case 'VOID':
      return { word: 'Void', tone: 'bad' };
    case 'EXPIRED':
      return { word: 'Expired', tone: 'neutral' };
    case 'TRANSFERRED':
      return { word: 'Transferred', tone: 'info' };
    default:
      return { word: state.replace(/_/g, ' ').toLowerCase(), tone: 'neutral' };
  }
}

/**
 * Where a ticket admits you, without saying it twice.
 *
 * Several partners name the ticket after the venue ("Phoenix Cinemas — Viman
 * Nagar"), and an object that then prints the venue under "Where" reads as a
 * mistake. So: the locality when the title already carries the name, the full
 * name when it does not, and nothing at all when there is no venue.
 */
export function ticketWhere(
  title: string,
  venue: { name: string; locality: string | null } | null | undefined,
): string | null {
  if (!venue) return null;
  if (title.includes(venue.name)) return venue.locality;
  return venue.locality ? `${venue.name} · ${venue.locality}` : venue.name;
}
