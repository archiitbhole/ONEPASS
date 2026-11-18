/**
 * The create-a-deal form.
 *
 * The price shown as you type is computed on the server by the same
 * `computePrice` the offer service uses, against the slot's real list price —
 * this component holds no pricing arithmetic of its own. That costs a round trip
 * per edit (debounced) and buys the only property that matters: the number on the
 * screen and the number that gets stored cannot drift apart, because they come
 * from the same function.
 *
 * The preview is a courtesy. `createOffer` recomputes and re-validates on save,
 * so a form that lies — or a POST that skips the form entirely — changes nothing.
 */
'use client';

import { Suspense, useActionState, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Badge, Field, formatMoney } from '@/components/ui';
import {
  EMPTY_PREVIEW,
  IDLE_DEAL_STATE,
  type DealFormState,
  type PricePreview,
  type SlotOption,
} from './deal-state';

interface Props {
  slots: SlotOption[];
  preview: (slotId: string, discountKind: string, discountValue: number) => Promise<PricePreview>;
  submit: (prev: DealFormState, formData: FormData) => Promise<DealFormState>;
  defaultStartsAt: string;
  defaultEndsAt: string;
}

const KIND_HINTS: Record<string, string> = {
  PERCENT: 'Percentage off the slot’s list price. Between 1 and 90.',
  FLAT: 'Rupees off the slot’s list price.',
  FIXED_PRICE: 'The price the consumer pays, in rupees.',
};

/**
 * A deal can be arrived at from the Demand page, which already knows which slot
 * is expected to run empty and by how much to mark it down. Those arrive as query
 * parameters and seed the fields below; nothing else changes, and every value is
 * still recomputed and re-validated on save. A slot id that is not in this
 * organization's own list is ignored rather than trusted — the list was built
 * server-side from the tenant's venues.
 */
export function DealForm(props: Props) {
  return (
    <Suspense fallback={<DealFormFields {...props} />}>
      <PrefilledDealForm {...props} />
    </Suspense>
  );
}

function PrefilledDealForm(props: Props) {
  const search = useSearchParams();
  const wanted = search.get('slotId');
  const kind = search.get('discountKind');
  const value = search.get('discountValue');

  return (
    <DealFormFields
      {...props}
      prefill={{
        slotId: props.slots.some((slot) => slot.slotId === wanted) ? wanted : null,
        discountKind: kind === 'PERCENT' || kind === 'FLAT' || kind === 'FIXED_PRICE' ? kind : null,
        discountValue: value !== null && Number.isFinite(Number(value)) ? value : null,
        title: search.get('title'),
        startsAt: search.get('startsAt'),
        endsAt: search.get('endsAt'),
      }}
    />
  );
}

interface Prefill {
  slotId: string | null;
  discountKind: string | null;
  discountValue: string | null;
  title: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

function DealFormFields({
  slots,
  preview,
  submit,
  defaultStartsAt,
  defaultEndsAt,
  prefill,
}: Props & { prefill?: Prefill }) {
  const [state, action, submitting] = useActionState(submit, IDLE_DEAL_STATE);

  const [slotId, setSlotId] = useState(prefill?.slotId ?? slots[0]?.slotId ?? '');
  const [discountKind, setDiscountKind] = useState(prefill?.discountKind ?? 'PERCENT');
  const [discountValue, setDiscountValue] = useState(prefill?.discountValue ?? '20');
  const [quote, setQuote] = useState<PricePreview>(EMPTY_PREVIEW);
  const [pricing, setPricing] = useState(false);

  useEffect(() => {
    if (!slotId) {
      setQuote(EMPTY_PREVIEW);
      return;
    }

    let cancelled = false;
    setPricing(true);

    // Debounced: a keystroke should not be a request, but a pause should be.
    const timer = window.setTimeout(() => {
      const value = Number(discountValue);
      preview(slotId, discountKind, Number.isFinite(value) ? Math.round(value) : NaN)
        .then((result) => {
          if (!cancelled) setQuote(result);
        })
        .catch(() => {
          if (!cancelled) setQuote({ ...EMPTY_PREVIEW, message: 'Could not price that rule just now.' });
        })
        .finally(() => {
          if (!cancelled) setPricing(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      setPricing(false);
      window.clearTimeout(timer);
    };
  }, [slotId, discountKind, discountValue, preview]);

  const slot = slots.find((s) => s.slotId === slotId) ?? null;

  return (
    <form action={action} className="stack stack-5">
      {state.phase === 'error' && state.message ? (
        <div className="notice notice-bad" role="alert">
          {state.message}
        </div>
      ) : null}

      <div className="stack stack-4">
        <Field
          label="Capacity slot"
          htmlFor="slotId"
          hint="Only slots with capacity left are listed. The deal is priced from this slot's list price."
          error={state.field === 'slotId' ? state.message : null}
        >
          <select
            id="slotId"
            name="slotId"
            className="select"
            value={slotId}
            onChange={(event) => setSlotId(event.target.value)}
            required
          >
            {slots.map((option) => (
              <option key={option.slotId} value={option.slotId}>
                {option.venueName} · {option.label} · {option.when} · {option.available}/{option.capacity} left ·{' '}
                {formatMoney(option.listPriceMinor, option.currency)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Title"
          htmlFor="title"
          hint="What a consumer sees in the Live Deals list."
          error={state.field === 'title' ? state.message : null}
        >
          <input
            id="title"
            name="title"
            className="input"
            maxLength={160}
            required
            defaultValue={prefill?.title ?? undefined}
            placeholder="Late table, 40% off"
          />
        </Field>

        <Field label="Description" htmlFor="description" hint="Optional. One line of detail.">
          <input id="description" name="description" className="input" maxLength={300} />
        </Field>

        <div className="grid grid-2">
          <Field
            label="Discount kind"
            htmlFor="discountKind"
            hint={KIND_HINTS[discountKind]}
            error={state.field === 'discountKind' ? state.message : null}
          >
            <select
              id="discountKind"
              name="discountKind"
              className="select"
              value={discountKind}
              onChange={(event) => setDiscountKind(event.target.value)}
            >
              <option value="PERCENT">Percentage off</option>
              <option value="FLAT">Rupees off</option>
              <option value="FIXED_PRICE">Fixed price</option>
            </select>
          </Field>

          <Field
            label={discountKind === 'PERCENT' ? 'Percent' : 'Rupees'}
            htmlFor="discountValue"
            error={state.field === 'discountValue' ? state.message : null}
          >
            <input
              id="discountValue"
              name="discountValue"
              className="input input-mono"
              type="number"
              min={discountKind === 'PERCENT' ? 1 : 0}
              max={discountKind === 'PERCENT' ? 90 : undefined}
              step={discountKind === 'PERCENT' ? 1 : 1}
              value={discountValue}
              onChange={(event) => setDiscountValue(event.target.value)}
              required
            />
          </Field>
        </div>
      </div>

      {/* The computed result, from the server, for the rule as it stands. */}
      <div className="card-flat" aria-live="polite">
        <div className="row-between">
          <p className="eyebrow">Resulting price</p>
          {pricing ? <span className="spinner" aria-label="Pricing" /> : null}
        </div>

        {quote.ok && quote.priceMinor !== null && quote.listPriceMinor !== null ? (
          <div className="row-between" style={{ marginTop: 8, alignItems: 'baseline' }}>
            <p className="num">{formatMoney(quote.priceMinor, quote.currency)}</p>
            <p className="small muted">
              <s>{formatMoney(quote.listPriceMinor, quote.currency)}</s> · saves{' '}
              {formatMoney(quote.savedMinor, quote.currency)} (
              {Math.round((quote.savedMinor / quote.listPriceMinor) * 100)}%)
            </p>
          </div>
        ) : (
          <p className="small muted" style={{ marginTop: 8 }}>
            {quote.message ?? 'Choose a slot and a rule to see the price a consumer would pay.'}
          </p>
        )}

        {slot ? (
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Priced against {slot.venueName} · {slot.label}, list{' '}
            {formatMoney(slot.listPriceMinor, slot.currency)}, {slot.available} unsold.
          </p>
        ) : null}
      </div>

      <div className="grid grid-2">
        <Field
          label="Starts"
          htmlFor="startsAt"
          hint="Asia/Kolkata."
          error={state.field === 'startsAt' ? state.message : null}
        >
          <input
            id="startsAt"
            name="startsAt"
            className="input"
            type="datetime-local"
            defaultValue={prefill?.startsAt ?? defaultStartsAt}
            required
          />
        </Field>
        <Field
          label="Ends"
          htmlFor="endsAt"
          hint="Asia/Kolkata. Cannot run past the end of the slot."
          error={state.field === 'endsAt' ? state.message : null}
        >
          <input
            id="endsAt"
            name="endsAt"
            className="input"
            type="datetime-local"
            defaultValue={prefill?.endsAt ?? defaultEndsAt}
            required
          />
        </Field>
      </div>

      <div className="grid grid-2">
        <Field
          label="Cap on redemptions"
          htmlFor="maxRedemptions"
          hint="Optional. Leave blank for as many as the slot holds."
          error={state.field === 'maxRedemptions' ? state.message : null}
        >
          <input
            id="maxRedemptions"
            name="maxRedemptions"
            className="input input-mono"
            type="number"
            min={1}
            max={slot?.available}
            placeholder={slot ? String(slot.available) : ''}
          />
        </Field>

        <Field label="Offer kind" htmlFor="kind" hint="Live Deal is the time-boxed markdown consumers see.">
          <select id="kind" name="kind" className="select" defaultValue="LIVE_DEAL">
            <option value="LIVE_DEAL">Live Deal</option>
            <option value="STANDING">Standing discount</option>
            <option value="CAMPAIGN">Campaign</option>
          </select>
        </Field>
      </div>

      <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <input type="checkbox" name="publish" style={{ marginTop: 3 }} />
        <span>
          <span style={{ fontWeight: 600 }}>Publish now</span>
          <span className="small muted" style={{ display: 'block' }}>
            Leave unticked to save as a draft. A deal whose window has not opened is saved as scheduled and
            goes live by itself.
          </span>
        </span>
      </label>

      <div className="row-wrap">
        <button type="submit" className="btn btn-primary" disabled={submitting || slots.length === 0}>
          {submitting ? <span className="spinner" aria-hidden="true" /> : null}
          {submitting ? 'Saving…' : 'Create deal'}
        </button>
        <Badge tone="neutral">Price is recomputed on save</Badge>
      </div>
    </form>
  );
}
