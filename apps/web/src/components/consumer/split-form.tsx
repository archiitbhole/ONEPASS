'use client';

/**
 * Starting a split, and the one moment its claim tokens exist.
 *
 * Client-side for two reasons, both real:
 *
 *  · The participant list is added to and removed from, and the columns change
 *    with the method — an amount each, a number of shares each, or neither.
 *  · `createSplit` returns one plaintext claim token per share and never returns
 *    them again. They come back through `useActionState` and are held in React
 *    state on this page. They are never put in a URL, because a query string is
 *    written to browser history and to every log in front of the app.
 *
 * The arithmetic below the total is a courtesy, not a gate: the split's own rule
 * — that the shares sum to exactly the total — is enforced by `allocateShares`
 * inside the transaction, and its refusal is what the person is shown.
 */
import { useActionState, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Notice, TableScroll, formatMoney } from '@/components/ui';
import { createSplitAction, type CreateSplitState } from '@/app/(app)/split/actions';
import { BRAND } from '@/lib/brand';

interface Row {
  key: number;
  label: string;
  amount: string;
  units: string;
  contact: string;
}

const METHODS: { value: string; label: string; hint: string }[] = [
  { value: 'EQUAL', label: 'Equally', hint: 'Everyone pays the same. The odd paise land on your share, never on theirs.' },
  { value: 'BY_AMOUNT', label: 'By amount', hint: 'You set each person’s amount. They have to add up to the total exactly.' },
  { value: 'BY_SHARE', label: 'By share', hint: 'Weighted — two shares pays twice one share.' },
];

export function SplitForm({ organiserLabel }: { organiserLabel: string }) {
  const [state, submit, pending] = useActionState<CreateSplitState, FormData>(createSplitAction, {
    status: 'idle',
  });

  const [method, setMethod] = useState('EQUAL');
  const [total, setTotal] = useState('');
  const [rows, setRows] = useState<Row[]>([
    { key: 0, label: organiserLabel, amount: '', units: '1', contact: '' },
    { key: 1, label: '', amount: '', units: '1', contact: '' },
  ]);
  /*
    The counter behind a new row's key.

    It was a module-level `let` before, incremented during render. On the server
    that is one counter shared by every request the process handles, so the two
    rows this form starts with came back with whatever numbers that request
    happened to land on — and the browser, whose module starts at 1 again,
    rendered different `id`s and `htmlFor`s on hydration. A ref is per-component
    and never advances on the server, so both passes agree.
  */
  const nextKey = useRef(2);

  function patch(key: number, field: keyof Omit<Row, 'key'>, value: string) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }

  const allocated = rows.reduce((sum, r) => {
    const n = Number(r.amount);
    return Number.isFinite(n) && r.amount.trim() !== '' ? sum + Math.round(n * 100) : sum;
  }, 0);
  const totalMinor = (() => {
    const n = Number(total);
    return Number.isFinite(n) && total.trim() !== '' ? Math.round(n * 100) : 0;
  })();

  if (state.status === 'created') {
    return (
      <Card>
        <div className="stack stack-4">
          <div>
            <p className="eyebrow">Split created</p>
            <h2 className="h2">{state.title}</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              {formatMoney(state.totalMinor, state.currency)} across {state.tokens.length} people ·{' '}
              <Link className="mono" href={`/split/${state.publicRef}`}>
                {state.publicRef}
              </Link>
            </p>
          </div>

          <Notice tone="warn">
            <span>
              <strong>These claim tokens are shown once and cannot be recovered.</strong> {BRAND.name}{' '}
              stores only their SHA-256, so nobody — not you, not support, not an administrator —
              can read one back. Copy them now if you want them. Leaving this page loses them, and
              the split itself is unaffected either way.
            </span>
          </Notice>

          <TableScroll>
            <table className="table">
              <caption className="sr-only">One claim token per share, shown once</caption>
              <thead>
                <tr>
                  <th scope="col">Share</th>
                  <th scope="col" className="table-num">
                    Owes
                  </th>
                  <th scope="col">Claim token</th>
                </tr>
              </thead>
              <tbody>
                {state.tokens.map((t) => (
                  <tr key={t.token}>
                    <td>
                      {t.displayLabel}
                      {t.isOrganiser ? (
                        <span className="tiny muted" style={{ display: 'block' }}>
                          your own share — you do not need to send this anywhere
                        </span>
                      ) : null}
                    </td>
                    <td className="table-num">{formatMoney(t.amountMinor, state.currency)}</td>
                    <td className="mono tiny break-all">{t.token}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>

          <Notice tone="info">
            <span>
              Honest about what these are for: nothing in this build redeems a split token yet.
              Settling a share needs a captured payment to point at, and there is no checkout wired
              here, so there is no page a token opens. The tokens are printed because this is the
              only moment they exist — not because there is a link behind them today.
            </span>
          </Notice>

          <div className="row-wrap">
            <Link className="btn btn-primary" href={`/split/${state.publicRef}`}>
              Open the split
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form action={submit} className="stack stack-4">
        <h2 className="h3">Split something</h2>

        {state.status === 'error' ? (
          <Notice tone="bad">
            <span role="alert">{state.message}</span>
          </Notice>
        ) : null}

        <div className="field">
          <label className="label" htmlFor="split-title">
            What is it for?
          </label>
          <input
            className="input"
            id="split-title"
            name="title"
            required
            minLength={3}
            maxLength={160}
            placeholder="Dinner at Malaka Spice"
            autoComplete="off"
          />
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label className="label" htmlFor="split-total">
              Total
            </label>
            <input
              className="input"
              id="split-total"
              name="totalRupees"
              type="number"
              min="1"
              step="0.01"
              required
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="3200"
            />
            <p className="hint">In rupees. Stored as whole paise.</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="split-method">
              Divided how?
            </label>
            <select
              className="select input"
              id="split-method"
              name="method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="hint">{METHODS.find((m) => m.value === method)?.hint}</p>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="split-note">
            Note <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <input className="input" id="split-note" name="note" maxLength={300} autoComplete="off" />
        </div>

        <fieldset className="stack stack-3">
          <legend className="label" style={{ marginBottom: 8 }}>
            Who is in it?
          </legend>

          {rows.map((row, index) => (
            <div key={row.key} className="card-flat stack stack-3">
              <div className="row-between">
                <span className="tiny muted">
                  {index === 0 ? 'Your share — the rounding lands here' : `Person ${index + 1}`}
                </span>
                {index > 0 ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>

              <div className="grid grid-2">
                <div className="field">
                  <label className="label" htmlFor={`split-label-${row.key}`}>
                    Name
                  </label>
                  <input
                    className="input"
                    id={`split-label-${row.key}`}
                    name="label"
                    maxLength={80}
                    value={row.label}
                    onChange={(e) => patch(row.key, 'label', e.target.value)}
                    placeholder={index === 0 ? 'You' : 'Rahul'}
                    autoComplete="off"
                  />
                </div>

                <div className="field">
                  <label className="label" htmlFor={`split-contact-${row.key}`}>
                    Email or mobile <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    className="input"
                    id={`split-contact-${row.key}`}
                    name="contact"
                    maxLength={120}
                    value={row.contact}
                    onChange={(e) => patch(row.key, 'contact', e.target.value)}
                    autoComplete="off"
                  />
                  <p className="hint">Hashed on the way in. The address itself is never stored.</p>
                </div>
              </div>

              {/* Either every row carries the field or none does, so the four
                  parallel lists the action reads stay index-aligned. */}
              {method === 'BY_AMOUNT' ? (
                <div className="field">
                  <label className="label" htmlFor={`split-amount-${row.key}`}>
                    Owes
                  </label>
                  <input
                    className="input"
                    id={`split-amount-${row.key}`}
                    name="amountRupees"
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.amount}
                    onChange={(e) => patch(row.key, 'amount', e.target.value)}
                  />
                </div>
              ) : null}

              {method === 'BY_SHARE' ? (
                <div className="field">
                  <label className="label" htmlFor={`split-units-${row.key}`}>
                    Shares
                  </label>
                  <input
                    className="input"
                    id={`split-units-${row.key}`}
                    name="shareUnits"
                    type="number"
                    min="1"
                    step="1"
                    value={row.units}
                    onChange={(e) => patch(row.key, 'units', e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ))}

          <div className="row-wrap">
            <Button
              onClick={() =>
                setRows((c) => [...c, { key: nextKey.current++, label: '', amount: '', units: '1', contact: '' }])
              }
            >
              Add someone
            </Button>
            {method === 'BY_AMOUNT' && totalMinor > 0 ? (
              <span className={allocated === totalMinor ? 'small muted' : 'small'}>
                Shares add up to {formatMoney(allocated)} of {formatMoney(totalMinor)}
                {allocated === totalMinor ? ' — that matches.' : ' — these have to match exactly.'}
              </span>
            ) : null}
          </div>
        </fieldset>

        <div>
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {pending ? <span className="spinner" aria-hidden="true" /> : null}
            Create the split
          </Button>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            One claim token per share is generated when you create it, shown on the next screen, and
            never shown again.
          </p>
        </div>
      </form>
    </Card>
  );
}
