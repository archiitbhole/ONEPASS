/**
 * The counter console: scan a pass, ring up a sale, issue the receipt.
 *
 * A client component for the same reason the door is one — the verdict has to
 * land next to the field that was just submitted without losing the page under
 * it — plus one this page has and the door does not: a basket grows and shrinks
 * while it is being rung up, and rows cannot need a round trip to appear.
 *
 * Three rules this component keeps to:
 *
 * 1. **It never computes money.** Line totals, the discount apportionment, the
 *    tax and the total all come back from the receipt service. The basket shows
 *    what was typed; the review shows what the service says it costs. A browser
 *    that added up the same numbers would be a second, silent source of truth,
 *    and the day the two disagreed the customer would be the one to find out.
 * 2. **It never rewords a refusal.** Every message rendered here was written by
 *    the service that refused, because the wording of a rejection is a security
 *    decision — an expired code and an unknown one deliberately do not read
 *    differently enough to enumerate with.
 * 3. **It shows the person as the shop knows them.** A customer reference
 *    always; a name only when consent produced one, and labelled when it did
 *    not, so staff can tell "no consent" from "no name".
 */
'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Badge, Icon, Money, formatMoney } from '@/components/ui';
import {
  EMPTY_LINE,
  IDLE_COUNTER_STATE,
  type CounterState,
  type DraftLine,
} from './counter-state';

type CounterAction = (prev: CounterState, formData: FormData) => Promise<CounterState>;

export interface CounterVenue {
  id: string;
  name: string;
}

/** A line the operator is still typing, with the key React needs to keep it steady. */
interface Row extends DraftLine {
  key: number;
}

function rowsFrom(lines: DraftLine[] | undefined, from = 0): Row[] {
  if (!lines || lines.length === 0) return [{ ...EMPTY_LINE, key: from }];
  return lines.map((line, i) => ({ ...line, key: from + i }));
}

/**
 * The basket subtotal, in the operator's head-arithmetic sense.
 *
 * Deliberately *not* the receipt's subtotal: no discount, no tax, no
 * apportionment — just what the rows add up to, so a shopkeeper can catch a
 * mistyped price before pricing the sale. It is labelled as such on screen, and
 * the moment the service has spoken this is replaced by its figures.
 */
function typedTotal(rows: Row[]): number {
  return rows.reduce((sum, row) => {
    const qty = Number(row.quantity);
    const price = Number(row.unitPrice);
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return sum;
    return sum + Math.round(price * 100) * Math.max(0, Math.trunc(qty));
  }, 0);
}

export function CounterConsole({
  identify,
  review,
  amend,
  issue,
  reset,
  venues,
}: {
  identify: CounterAction;
  review: CounterAction;
  amend: CounterAction;
  issue: CounterAction;
  reset: () => Promise<CounterState>;
  venues: CounterVenue[];
}) {
  const [state, setState] = useState<CounterState>(IDLE_COUNTER_STATE);

  return (
    <div className="counter">
      {state.phase === 'identify' ? (
        <Identify action={identify} state={state} onDone={setState} />
      ) : null}

      {state.phase === 'compose' || state.phase === 'review' ? (
        <Sale
          state={state}
          review={review}
          amend={amend}
          issue={issue}
          venues={venues}
          onDone={setState}
        />
      ) : null}

      {state.phase === 'issued' && state.issued ? (
        <Issued state={state} reset={reset} onDone={setState} />
      ) : null}
    </div>
  );
}

/* ─────────────────────────────  identify  ───────────────────────────── */

function Identify({
  action,
  state,
  onDone,
}: {
  action: CounterAction;
  state: CounterState;
  onDone: (s: CounterState) => void;
}) {
  const [result, submit, pending] = useActionState(action, state);

  // `useActionState` owns its own copy; the parent needs it to switch phase.
  useEffect(() => {
    if (result.at !== state.at) onDone(result);
  }, [result, state.at, onDone]);

  return (
    <div className="stack stack-4">
      <form action={submit} className="stack stack-3">
        <div className="field">
          <label className="label" htmlFor="token">
            Customer&rsquo;s pass code
          </label>
          <input
            key={result.at ?? 'idle'}
            id="token"
            name="token"
            className="input input-mono"
            placeholder="OP1|px_7k2m9q4xz|482913|58392041"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={200}
            required
            autoFocus
            aria-describedby="token-hint"
          />
          <p className="hint" id="token-hint">
            The code rolls every 30 seconds, so it only works while the customer is here. A USB or
            Bluetooth scanner that types into this field works with no setup.
          </p>
        </div>

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : Icon.scan(18)}
          {pending ? 'Checking…' : 'Identify customer'}
        </button>
      </form>

      <div aria-live="assertive" aria-atomic="true">
        {result.error ? (
          <div className="notice notice-bad">
            {Icon.alert(16)}
            <span>{result.error}</span>
          </div>
        ) : null}
        {result.checks.length > 0 ? <Checks checks={result.checks} /> : null}
      </div>
    </div>
  );
}

function Checks({ checks }: { checks: CounterState['checks'] }) {
  return (
    <div className="card">
      <p className="eyebrow" style={{ marginBottom: 10 }}>
        What was checked
      </p>
      <div className="checklist">
        {checks.map((check) => (
          <div className="checkline" key={check.label}>
            <span className={`checkmark checkmark-${check.ok ? 'ok' : 'bad'}`} aria-hidden="true">
              {check.ok ? Icon.check(16) : Icon.cross(16)}
            </span>
            <span className="grow">
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{check.label}</span>
              <span className="tiny muted" style={{ display: 'block' }}>
                {check.detail}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────────  sale  ─────────────────────────────── */

function Sale({
  state,
  review,
  amend,
  issue,
  venues,
  onDone,
}: {
  state: CounterState;
  review: CounterAction;
  amend: CounterAction;
  issue: CounterAction;
  venues: CounterVenue[];
  onDone: (s: CounterState) => void;
}) {
  const nextKey = useRef(1000);
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(state.draft?.lines));
  const reviewing = state.phase === 'review';

  // One action element for both buttons: `formAction` on the submit button picks
  // which server action runs, so the same typed fields are what gets priced and
  // then what gets written. Two forms would mean copying the basket between them.
  const [result, submit, pending] = useActionState(
    async (prev: CounterState, formData: FormData) => {
      const intent = String(formData.get('intent') ?? 'review');
      if (intent === 'issue') return issue(prev, formData);
      if (intent === 'amend') return amend(prev, formData);
      return review(prev, formData);
    },
    state,
  );

  useEffect(() => {
    if (result.at !== state.at) {
      onDone(result);
      if (result.draft) setRows(rowsFrom(result.draft.lines, nextKey.current));
    }
  }, [result, state.at, onDone]);

  const draft = state.draft;
  const basket = typedTotal(rows);

  return (
    <form action={submit} className="stack stack-4">
      <input type="hidden" name="lineCount" value={rows.length} />

      <BuyerStrip state={state} />

      {/*
        `hidden`, never `disabled`.

        A disabled fieldset is not a read-only fieldset — the browser leaves every
        control inside it out of the submission entirely. Disabling the basket to
        lock it during review therefore posted an empty sale at the moment the
        operator pressed Issue, which the browser suite caught and no unit test
        could have. Hidden keeps the priced values in the form, out of reach and
        out of sight, and the reviewed total below is what makes tampering with
        them a refusal rather than a surprise.
      */}
      <fieldset className="counter-basket" hidden={reviewing}>
        <legend className="eyebrow">What was sold</legend>

        <div className="stack stack-3">
          {rows.map((row, i) => (
            <LineRow
              key={row.key}
              index={i}
              row={row}
              canRemove={rows.length > 1}
              onRemove={() => setRows((r) => r.filter((x) => x.key !== row.key))}
            />
          ))}
        </div>

        <div className="row-wrap" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              nextKey.current += 1;
              setRows((r) => [...r, { ...EMPTY_LINE, key: nextKey.current }]);
            }}
          >
            Add a line
          </button>
          <span className="small muted">
            Rows add up to <span className="mono">{formatMoney(basket)}</span> before discount and
            tax. The receipt&rsquo;s own figures are computed when you price the sale.
          </span>
        </div>
      </fieldset>

      <fieldset className="grid grid-2" hidden={reviewing}>
        <legend className="eyebrow">The sale</legend>

        <div className="field">
          <label className="label" htmlFor="discount">
            Discount (₹)
          </label>
          <input
            id="discount"
            name="discount"
            className="input input-mono"
            inputMode="decimal"
            defaultValue={draft?.discount ?? ''}
            placeholder="0"
          />
          <p className="hint">Spread across the lines before tax, so tax follows what was charged.</p>
        </div>

        <div className="field">
          <label className="label" htmlFor="paymentLabel">
            Paid with
          </label>
          <input
            id="paymentLabel"
            name="paymentLabel"
            className="input"
            maxLength={80}
            defaultValue={draft?.paymentLabel ?? ''}
            placeholder="UPI · card · cash"
          />
          <p className="hint">
            A label on the receipt. The money moved at your till, not here — nothing on this page
            takes a payment or confirms one.
          </p>
        </div>

        <div className="field">
          <label className="label" htmlFor="merchantReceiptNo">
            Your own receipt number
          </label>
          <input
            id="merchantReceiptNo"
            name="merchantReceiptNo"
            className="input input-mono"
            maxLength={80}
            defaultValue={draft?.merchantReceiptNo ?? ''}
            placeholder="INV-20481"
          />
          <p className="hint">Optional. Kept so you can reconcile this against your POS.</p>
        </div>

        <div className="field">
          <label className="label" htmlFor="gstin">
            GSTIN
          </label>
          <input
            id="gstin"
            name="gstin"
            className="input input-mono"
            maxLength={20}
            defaultValue={draft?.gstin ?? ''}
            placeholder="27AAECS1234F1Z5"
          />
          <p className="hint">Optional. Printed on the customer&rsquo;s copy as you supply it.</p>
        </div>

        {venues.length > 0 ? (
          <div className="field">
            <label className="label" htmlFor="venueId">
              Which shop
            </label>
            <select id="venueId" name="venueId" className="input" defaultValue={draft?.venueId ?? ''}>
              <option value="">Not recorded</option>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
            <p className="hint">Recorded on the receipt, and how per-shop figures are separated.</p>
          </div>
        ) : null}

        <div className="field">
          <label className="label" htmlFor="returnWindowDays">
            Returns accepted for (days)
          </label>
          <input
            id="returnWindowDays"
            name="returnWindowDays"
            className="input input-mono"
            inputMode="numeric"
            defaultValue={draft?.returnWindowDays ?? '7'}
          />
          <p className="hint">
            0 means no returns on this sale, and the receipt says so rather than staying silent.
          </p>
        </div>

        <div className="field counter-field-wide">
          <label className="label" htmlFor="returnPolicyNote">
            Return policy note
          </label>
          <input
            id="returnPolicyNote"
            name="returnPolicyNote"
            className="input"
            maxLength={500}
            defaultValue={draft?.returnPolicyNote ?? ''}
            placeholder="Unopened, with the box, at any branch"
          />
        </div>
      </fieldset>

      <div aria-live="assertive" aria-atomic="true">
        {state.error ? (
          <div className="notice notice-bad">
            {Icon.alert(16)}
            <span>{state.error}</span>
          </div>
        ) : null}
      </div>

      {reviewing && state.totals ? (
        <>
          {/*
            The figure the operator just read to the customer, sent back with the
            sale. `issueReceipt` recomputes the total from the lines and refuses
            the whole receipt if the two disagree — so the price on the button is
            the price written, or nothing is written at all.
          */}
          <input type="hidden" name="reviewedTotalMinor" value={state.totals.totalMinor} />
          <Review totals={state.totals} rows={rows} pending={pending} />
        </>
      ) : (
        <button type="submit" name="intent" value="review" className="btn btn-primary btn-lg btn-block" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : null}
          {pending ? 'Pricing…' : 'Price this sale'}
        </button>
      )}
    </form>
  );
}

function BuyerStrip({ state }: { state: CounterState }) {
  const buyer = state.buyer;
  if (!buyer) return null;

  return (
    <div className="counter-buyer">
      <div>
        <p className="eyebrow">Selling to</p>
        <p className="h3">
          {buyer.displayName ?? <span className="muted">Name not shared</span>}
        </p>
        <p className="tiny muted mono">{buyer.customerRef}</p>
      </div>
      <div className="counter-buyer-note">
        <Badge tone="ok" dot>
          Pass verified
        </Badge>
        <p className="tiny muted">
          {buyer.displayName
            ? 'Their name is shown because they granted it. The receipt goes to their pass either way.'
            : 'They have not granted their name to this business. The receipt still reaches them.'}
        </p>
      </div>
    </div>
  );
}

function Review({
  totals,
  rows,
  pending,
}: {
  totals: NonNullable<CounterState['totals']>;
  rows: Row[];
  pending: boolean;
}) {
  return (
    <div className="counter-review">
      <p className="eyebrow">What the customer pays</p>

      <table className="table">
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col" className="table-num">Goods</th>
            <th scope="col" className="table-num">Discount</th>
            <th scope="col" className="table-num">Tax</th>
          </tr>
        </thead>
        <tbody>
          {totals.lines.map((line) => (
            <tr key={line.position}>
              <td>{rows[line.position - 1]?.description ?? `Line ${line.position}`}</td>
              <td className="table-num"><Money minor={line.lineTotalMinor} /></td>
              <td className="table-num">
                {line.discountShareMinor > 0 ? <>−<Money minor={line.discountShareMinor} /></> : <span className="muted">—</span>}
              </td>
              <td className="table-num"><Money minor={line.taxMinor} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Subtotal</th>
            <td className="table-num" colSpan={3}><Money minor={totals.subtotalMinor} /></td>
          </tr>
          {totals.discountMinor > 0 ? (
            <tr>
              <th scope="row">Discount</th>
              <td className="table-num" colSpan={3}>−<Money minor={totals.discountMinor} /></td>
            </tr>
          ) : null}
          <tr>
            <th scope="row">Tax</th>
            <td className="table-num" colSpan={3}><Money minor={totals.taxMinor} /></td>
          </tr>
          <tr className="counter-total">
            <th scope="row">Total</th>
            <td className="table-num" colSpan={3}><Money minor={totals.totalMinor} /></td>
          </tr>
        </tfoot>
      </table>

      <p className="small muted">
        These are the receipt service&rsquo;s own figures, computed from the lines above by the same
        function that will write the receipt. Nothing is added after this screen.
      </p>

      <div className="row-wrap">
        <button type="submit" name="intent" value="issue" className="btn btn-primary btn-lg" disabled={pending}>
          {pending ? <span className="spinner" aria-hidden="true" /> : Icon.check(18)}
          {pending ? 'Issuing…' : `Issue receipt for ${formatMoney(totals.totalMinor)}`}
        </button>
        <button type="submit" name="intent" value="amend" className="btn btn-lg" disabled={pending}>
          Change something
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────  issued  ────────────────────────────── */

function Issued({
  state,
  reset,
  onDone,
}: {
  state: CounterState;
  reset: () => Promise<CounterState>;
  onDone: (s: CounterState) => void;
}) {
  const issued = state.issued!;

  return (
    <div className="verdict verdict-ok">
      <div className="verdict-mark">{Icon.check(30)}</div>
      <p className="verdict-title">Receipt issued</p>
      <p style={{ marginTop: 8, fontSize: 16, fontWeight: 500 }}>
        {formatMoney(issued.totalMinor, issued.currency)} to{' '}
        <span className="mono">{issued.customerRef}</span>. It is on their pass now.
      </p>

      <dl className="dl" style={{ marginTop: 16, textAlign: 'left' }}>
        <div>
          <dt>Reference</dt>
          <dd className="mono">{issued.publicRef}</dd>
        </div>
        <div>
          <dt>Tax</dt>
          <dd className="mono">{formatMoney(issued.taxMinor, issued.currency)}</dd>
        </div>
        <div>
          <dt>Warranties tracked</dt>
          <dd>
            {issued.warrantiesIssued === 0
              ? 'None on this sale'
              : `${issued.warrantiesIssued} — the customer can claim without the paper`}
          </dd>
        </div>
        <div>
          <dt>Returns</dt>
          <dd>
            {issued.returnWindowDays > 0
              ? `Accepted for ${issued.returnWindowDays} days`
              : 'Not accepted on this receipt'}
          </dd>
        </div>
      </dl>

      <form
        action={async () => {
          onDone(await reset());
        }}
        style={{ marginTop: 16 }}
      >
        <button type="submit" className="btn btn-primary btn-lg">
          Next customer
        </button>
      </form>
    </div>
  );
}

/* ────────────────────────────  one line  ───────────────────────────── */

function LineRow({
  index,
  row,
  canRemove,
  onRemove,
}: {
  index: number;
  row: Row;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const id = (field: string) => `line-${row.key}-${field}`;
  const name = (field: string) => `line.${index}.${field}`;

  return (
    <div className="counter-line">
      <div className="field counter-line-what">
        <label className="label" htmlFor={id('description')}>
          Item {index + 1}
        </label>
        <input
          id={id('description')}
          name={name('description')}
          className="input"
          maxLength={200}
          defaultValue={row.description}
          placeholder="Kettle, 1.7L"
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={id('sku')}>
          SKU
        </label>
        <input
          id={id('sku')}
          name={name('sku')}
          className="input input-mono"
          maxLength={80}
          defaultValue={row.sku}
        />
      </div>

      <div className="field counter-line-qty">
        <label className="label" htmlFor={id('quantity')}>
          Qty
        </label>
        <input
          id={id('quantity')}
          name={name('quantity')}
          className="input input-mono"
          inputMode="numeric"
          defaultValue={row.quantity}
        />
      </div>

      <div className="field counter-line-price">
        <label className="label" htmlFor={id('unitPrice')}>
          Unit price (₹)
        </label>
        <input
          id={id('unitPrice')}
          name={name('unitPrice')}
          className="input input-mono"
          inputMode="decimal"
          defaultValue={row.unitPrice}
        />
      </div>

      <div className="field counter-line-tax">
        <label className="label" htmlFor={id('taxPercent')}>
          Tax %
        </label>
        <input
          id={id('taxPercent')}
          name={name('taxPercent')}
          className="input input-mono"
          inputMode="decimal"
          defaultValue={row.taxPercent}
        />
      </div>

      <div className="field counter-line-warranty">
        <label className="label" htmlFor={id('warrantyMonths')}>
          Warranty (months)
        </label>
        <input
          id={id('warrantyMonths')}
          name={name('warrantyMonths')}
          className="input input-mono"
          inputMode="numeric"
          defaultValue={row.warrantyMonths}
          placeholder="—"
        />
      </div>

      <div className="field counter-line-serial">
        <label className="label" htmlFor={id('serialNumber')}>
          Serial number
        </label>
        <input
          id={id('serialNumber')}
          name={name('serialNumber')}
          className="input input-mono"
          maxLength={120}
          defaultValue={row.serialNumber}
          placeholder="—"
        />
      </div>

      <div className="counter-line-flags">
        <label className="row" style={{ gap: 6, alignItems: 'center' }} htmlFor={id('returnable')}>
          <input
            id={id('returnable')}
            name={name('returnable')}
            type="checkbox"
            defaultChecked={row.returnable}
          />
          <span>Returnable</span>
        </label>

        {canRemove ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRemove}>
            Remove item {index + 1}
          </button>
        ) : null}
      </div>
    </div>
  );
}
