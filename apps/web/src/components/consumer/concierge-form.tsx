'use client';

/**
 * The venue concierge, on the trip screen.
 *
 * A client component so the answer arrives without re-running the trip solver —
 * a page reload would re-plan the days underneath the person while they were
 * reading them.
 *
 * The rendering rule is the whole point of the component. `answerVenueQuestion`
 * returns `sources`: the rows every claim in the answer came from. An answer
 * with sources is shown with them listed, so the claim can be checked. An answer
 * with no sources behind it is not shown as an answer at all — it is shown as "I
 * don't have that on file", because a sentence with nothing behind it is a guess
 * whatever it sounds like, and the person it is wrong to is standing outside a
 * venue at 22:40.
 */
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardHead, Notice } from '@/components/ui';
import { askConciergeAction, type ConciergeState } from '@/app/(app)/travel/stay/actions';
import { BRAND } from '@/lib/brand';

export interface ConciergeVenue {
  venueId: string;
  name: string;
  locality: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  venue: 'Venue record',
  offer: 'Live offer',
  inventory_slot: 'Inventory slot',
  booking: 'Your booking',
};

const EXAMPLES = ['What time does it open?', 'Is there parking?', 'How much does it cost?', 'Do I have a booking here?'];

export function ConciergeForm({ venues }: { venues: ConciergeVenue[] }) {
  const first = venues[0];
  const [venueId, setVenueId] = useState(first?.venueId ?? '');
  const [state, submit, pending] = useActionState<ConciergeState, FormData>(askConciergeAction, {
    status: 'idle',
  });

  if (venues.length === 0) {
    return (
      <Card>
        <CardHead title="Ask about a venue" />
        <p className="small muted">
          The concierge answers about a venue that is in your trip. Plan one above and the venues it
          chose appear here.
        </p>
      </Card>
    );
  }

  const answeredVenue =
    state.status === 'answered' ? venues.find((v) => v.venueId === state.venueId) : undefined;

  return (
    <Card>
      <CardHead
        title="Ask about a venue"
        action={<Badge tone="neutral">Answers from rows only</Badge>}
      />

      <form action={submit} className="stack stack-4">
        <div className="field">
          <label className="label" htmlFor="concierge-venue">
            Venue
          </label>
          <select
            className="select input"
            id="concierge-venue"
            name="venueId"
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
          >
            {venues.map((v) => (
              <option key={v.venueId} value={v.venueId}>
                {v.name}
                {v.locality ? ` — ${v.locality}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="concierge-question">
            Your question
          </label>
          <input
            className="input"
            id="concierge-question"
            name="question"
            type="text"
            maxLength={300}
            placeholder="What time does it open?"
            autoComplete="off"
          />
          <p className="hint">
            It handles opening hours, facilities, directions, prices, live offers and your own
            bookings. Anything else comes back as “I don’t know”, on purpose.
          </p>
        </div>

        <div className="row-wrap">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Looking…' : 'Ask'}
          </Button>
          <span className="tiny muted">Examples: {EXAMPLES.join(' · ')}</span>
        </div>
      </form>

      {state.status === 'error' ? (
        <div style={{ marginTop: 16 }}>
          <Notice tone="bad">
            <span role="alert">{state.message}</span>
          </Notice>
        </div>
      ) : null}

      {state.status === 'answered' ? (
        <div className="stack stack-3" style={{ marginTop: 16 }}>
          <div className="row-wrap">
            <Badge tone={state.confident ? 'ok' : 'warn'} dot>
              {state.confident ? 'Answered from rows' : 'Not on file'}
            </Badge>
            <Badge tone="neutral">{state.intent.replace(/_/g, ' ').toLowerCase()}</Badge>
            {answeredVenue ? <span className="tiny muted">{answeredVenue.name}</span> : null}
          </div>

          <div>
            <p className="eyebrow">You asked</p>
            <p className="small muted">“{state.question}”</p>
          </div>

          {!state.confident && state.sources.length > 0 ? (
            <Notice tone="warn">
              <span>
                Read what follows as “I don’t have that on file”. The venue record was found, but
                nothing in it answers the question — so nothing below is a claim about the venue
                itself.
              </span>
            </Notice>
          ) : null}

          {state.sources.length === 0 ? (
            <Notice tone="warn">
              <span>
                I don’t have that on file. Nothing in {BRAND.name} records an answer to that question, so
                there is nothing to give you — and a plausible sentence with no row behind it would
                be a guess. Support can put it to the operator at <Link href="/help">/help</Link>.
              </span>
            </Notice>
          ) : (
            <>
              <p>{state.answer}</p>
              <div>
                <p className="eyebrow">
                  Sources — {state.sources.length} {state.sources.length === 1 ? 'row' : 'rows'}
                </p>
                <ul className="stack stack-2" style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
                  {state.sources.map((source) => (
                    <li key={`${source.kind}:${source.id}`} className="row-wrap">
                      <Badge tone="neutral">{SOURCE_LABELS[source.kind] ?? source.kind}</Badge>
                      <span className="mono tiny muted break-all">{source.id}</span>
                    </li>
                  ))}
                </ul>
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  Every claim above came from those rows. If the answer is wrong, one of them is.
                </p>
              </div>
            </>
          )}

        </div>
      ) : null}
    </Card>
  );
}
