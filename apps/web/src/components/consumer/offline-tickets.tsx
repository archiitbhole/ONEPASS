'use client';

/**
 * The tickets this device is holding, drawn without a network.
 *
 * Everything here comes from `localStorage` and the QR is generated in the
 * browser from the reference — so this screen works with the radio off, which
 * is the entire point. It is the only place in ONEPASS that renders something
 * personal without asking the server, and it can be because the thing it
 * renders is not a secret: a ticket reference is what the door reads, and the
 * door is what decides.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { QrSvg } from '@/components/consumer/qr';
import { TicketStub } from '@/components/consumer/ticket-stub';
import { readKept, stillUsable, type KeptTicket } from '@/lib/offline/tickets';
import { BRAND } from '@/lib/brand';

/** Formatted here rather than on the server, which is not answering. */
function whenText(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function OfflineTickets() {
  // `null` while unread, so the first paint does not claim "no tickets" before
  // the store has been opened. Reading localStorage during render would also
  // mismatch the server's HTML, which has no way to know what this device holds.
  const [kept, setKept] = useState<KeptTicket[] | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setKept(readKept().filter((t) => stillUsable(t)));
    setOnline(navigator.onLine);

    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (kept === null) {
    return <p className="muted">Looking for tickets saved on this device…</p>;
  }

  return (
    <div className="stack stack-5">
      {online ? (
        <div className="notice notice-ok">
          <span>
            You are back online. <Link href="/home">Open {BRAND.name}</Link> for everything, live.
          </span>
        </div>
      ) : null}

      {kept.length === 0 ? (
        <div className="card stack stack-3">
          <h2 className="h3">No tickets are saved on this device</h2>
          <p className="muted">
            A ticket is kept here automatically the first time you open it, so it works in a
            basement or on a train. Nothing has been opened on this device yet — or site data was
            cleared since.
          </p>
        </div>
      ) : (
        <div className="stack stack-6">
          {kept.map((ticket) => (
            <div key={ticket.reference} className="stack stack-2">
              <TicketStub
                title={ticket.title}
                place={ticket.place}
                seatLabel={ticket.seatLabel}
                admitCount={ticket.admitCount}
                doorsAt={whenText(ticket.validFrom)}
                headingLevel={2}
                state={ticket.state}
                scannable
                reference={ticket.reference}
                code={
                  <QrSvg
                    text={ticket.reference}
                    level="M"
                    size={300}
                    title={`Ticket ${ticket.reference} — show this at the door`}
                  />
                }
              />
              <p className="tiny muted" style={{ textAlign: 'center' }}>
                {/* Said plainly, because it is the one caveat that matters: the
                    door is the authority and this copy is not. */}
                Saved on this device {whenText(ticket.keptAt)}. The door checks the live record — if
                this was cancelled since, it will be refused.
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="card stack stack-3">
        <h2 className="h3">What does not work offline</h2>
        <ul className="stack stack-2" style={{ paddingLeft: 18 }}>
          <li className="muted">
            <strong>Your pass.</strong> It is a code that changes every thirty seconds, and an old
            one is refused at a counter. There is no saved copy on purpose — a pass that looks
            valid and is not is worse than no pass at all.
          </li>
          <li className="muted">
            <strong>Balances, bookings and deals.</strong> All of them are facts about right now.
            Showing yesterday&rsquo;s number would be showing you something untrue.
          </li>
          <li className="muted">
            <strong>Buying anything.</strong> Nothing is queued to send later; a payment you cannot
            confirm is not a payment.
          </li>
        </ul>
      </div>
    </div>
  );
}
