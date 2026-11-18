/**
 * The door console.
 *
 * A client component for one reason: the verdict has to appear next to the field
 * that was just submitted, without losing the page under it. `useActionState`
 * gives that and still works with JavaScript disabled — the form posts, the
 * action runs, the page comes back with the verdict rendered.
 *
 * There is no camera here on purpose. `packages/pass` ships a QR *encoder* and no
 * decoder, and adding one would mean adding a dependency this task is not
 * allowed to add — so rather than a viewfinder that cannot read anything, the
 * console is built around the reference itself, which is what a member of staff
 * reads off the pass anyway when a scan fails.
 *
 * The verdict wording is the service's own `message`. Nothing here rephrases it:
 * "not a ONEPASS ticket" is deliberately what both an unknown code and another
 * partner's ticket say, and a friendlier console would turn the door into an
 * oracle for enumerating other people's tickets.
 */
'use client';

import { useActionState } from 'react';
import { Badge, Icon } from '@/components/ui';
import { IDLE_DOOR_STATE, type DoorState } from './door-state';

type DoorAction = (prev: DoorState, formData: FormData) => Promise<DoorState>;

/** Reason → the colour the whole card takes. Only OK is green; nothing else is. */
function toneFor(reason: string): 'ok' | 'warn' | 'bad' {
  if (reason === 'OK') return 'ok';
  if (reason === 'NOT_YET_VALID') return 'warn';
  return 'bad';
}

function titleFor(reason: string): string {
  switch (reason) {
    case 'OK':
      return 'Admit';
    case 'ALREADY_ADMITTED':
      return 'Already used';
    case 'NOT_YET_VALID':
      return 'Too early';
    case 'EXPIRED':
      return 'Expired';
    case 'VOID':
      return 'Cancelled';
    case 'TRANSFERRED':
      return 'Transferred';
    default:
      return 'Do not admit';
  }
}

export function DoorConsole({ action }: { action: DoorAction }) {
  const [state, submit, pending] = useActionState(action, IDLE_DOOR_STATE);

  return (
    <div className="stack stack-4">
      <form action={submit} className="stack stack-3">
        <div className="field">
          <label className="label" htmlFor="reference">
            Ticket reference
          </label>
          <input
            /* Remounted per attempt so the field clears after a scan and keeps
               what was typed after a rejected one. */
            key={state.at ?? 'idle'}
            id="reference"
            name="reference"
            className="input input-mono"
            defaultValue={state.phase === 'error' ? (state.presented ?? '') : ''}
            placeholder="tkt_4h2k9wq7c"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            maxLength={64}
            required
            // Autofocused deliberately: this page exists to be typed into, and a
            // door with a queue at it should not need a click before the first scan.
            autoFocus
            aria-describedby="reference-hint"
          />
          <p className="hint" id="reference-hint">
            Printed under the QR on the pass. A hardware scanner that types into this field works as-is.
          </p>
        </div>

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : Icon.scan(18)}
          {pending ? 'Checking…' : 'Admit'}
        </button>
      </form>

      <div aria-live="assertive" aria-atomic="true">
        {state.phase === 'error' ? (
          <div className="notice notice-bad">
            {Icon.alert(16)}
            <span>{state.error}</span>
          </div>
        ) : null}

        {state.phase === 'result' && state.result ? (
          <div className={`verdict verdict-${toneFor(state.result.reason)}`}>
            <div className="verdict-mark">
              {state.result.ok ? Icon.check(30) : Icon.cross(30)}
            </div>
            <p className="verdict-title">{titleFor(state.result.reason)}</p>
            <p style={{ marginTop: 8, fontSize: 16, fontWeight: 500 }}>{state.result.message}</p>

            <p className="row-wrap" style={{ justifyContent: 'center', marginTop: 14 }}>
              <Badge tone={state.result.ok ? 'ok' : 'bad'}>{state.result.reason.replace(/_/g, ' ').toLowerCase()}</Badge>
              <span className="mono tiny muted">{state.presented}</span>
            </p>

            {state.result.ticket ? (
              <div className="card" style={{ marginTop: 16, textAlign: 'left' }}>
                <p className="h3">{state.result.ticket.title}</p>
                {state.result.ticket.subtitle ? (
                  <p className="small muted" style={{ marginTop: 4 }}>
                    {state.result.ticket.subtitle}
                  </p>
                ) : null}
                <dl className="dl" style={{ marginTop: 12 }}>
                  <div>
                    <dt>Admits</dt>
                    <dd className="mono">{state.result.ticket.admitCount}</dd>
                  </div>
                  {state.result.ticket.seatLabel ? (
                    <div>
                      <dt>Seat</dt>
                      <dd className="mono">{state.result.ticket.seatLabel}</dd>
                    </div>
                  ) : null}
                  {state.result.ticket.admittedAt ? (
                    <div>
                      <dt>{state.result.ok ? 'Admitted at' : 'Previously admitted'}</dt>
                      <dd className="mono">
                        {new Intl.DateTimeFormat('en-IN', {
                          hour: 'numeric',
                          minute: '2-digit',
                          day: 'numeric',
                          month: 'short',
                          timeZone: 'Asia/Kolkata',
                        }).format(new Date(state.result.ticket.admittedAt))}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
