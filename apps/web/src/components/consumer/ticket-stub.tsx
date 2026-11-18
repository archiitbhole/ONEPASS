/**
 * A ticket at door-facing size: the object, with the code on its stub.
 *
 * The material is `Ticket` from components/objects — cream stock in both
 * themes, a coloured band that says what kind of thing this admits you to, a
 * perforated tear line. This component is the arrangement the detail screen
 * needs: what matters at a door, in the order a person at a door needs it.
 *
 * A ticket that will not be admitted does not get a code. Showing a scannable
 * square for an already-admitted or expired ticket is a promise the door will
 * break in front of the person holding the phone, so the state is stamped
 * instead and the reason is said in words.
 */
import type { ReactNode } from 'react';
import { Ticket } from '@/components/objects';
import { ticketBandLabel, ticketKindFor, ticketStampWord, ticketStateOf } from './ticket-shape';

export interface TicketStubProps {
  title: string;
  subtitle?: string | null;
  place?: string | null;
  venueKind?: string | null;
  seatLabel?: string | null;
  admitCount: number;
  doorsAt: string;
  state: string;
  /** False when the door would refuse it — then no code is drawn. */
  scannable: boolean;
  reference: string;
  code: ReactNode;
  transitionName?: string;
  /** 1 where the ticket is the page (the detail screen), 2 in a list. */
  headingLevel?: 1 | 2;
}

export function TicketStub({
  title,
  subtitle,
  place,
  venueKind,
  seatLabel,
  admitCount,
  doorsAt,
  state,
  scannable,
  reference,
  code,
  transitionName,
  headingLevel = 1,
}: TicketStubProps) {
  const stamp = ticketStampWord(state);

  return (
    <Ticket
      kind={ticketKindFor(venueKind)}
      state={ticketStateOf(state)}
      label={`${title} — ticket ${reference}`}
      transitionName={transitionName}
    >
      <Ticket.Main>
        <Ticket.Band label={ticketBandLabel(venueKind)} right={seatLabel || undefined} />
        <Ticket.Title level={headingLevel}>{title}</Ticket.Title>
        {subtitle ? <p className="ticket-value">{subtitle}</p> : null}
        <Ticket.Fields
          items={[
            { label: 'Doors', value: doorsAt },
            ...(place ? [{ label: 'Where', value: place }] : []),
            { label: 'Admits', value: `${admitCount} ${admitCount === 1 ? 'person' : 'people'}` },
            { label: 'Reference', value: reference, mono: true },
          ]}
        />
      </Ticket.Main>
      <Ticket.Stub>
        {scannable ? (
          <>
            <div className="qr-frame">{code}</div>
            <span className="ticket-label">Show at the door</span>
          </>
        ) : (
          <>
            <Ticket.Stamp tone={stamp.tone}>{stamp.word}</Ticket.Stamp>
            <span className="ticket-label">No code</span>
          </>
        )}
      </Ticket.Stub>
    </Ticket>
  );
}
