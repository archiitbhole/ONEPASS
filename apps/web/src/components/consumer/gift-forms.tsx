'use client';

/**
 * The two things a person does with a gift: buy one, or claim one.
 *
 * Both are client components because both handle a token that must not travel in
 * a URL of our making. Creating one returns a claim link that exists exactly
 * once — `createGift` hands back the plaintext and stores only its SHA-256 —
 * and claiming one submits a token that has to be answered next to the field:
 * expired, already claimed, or your own gift are all sentences somebody needs to
 * read, not a redirect.
 */
import { useActionState } from 'react';
import Link from 'next/link';
import { Button, Card, Notice, formatMoney } from '@/components/ui';
import {
  claimGiftAction,
  createGiftAction,
  type ClaimGiftState,
  type CreateGiftState,
} from '@/app/(app)/gifts/actions';
import { BRAND } from '@/lib/brand';

export interface GiftableOption {
  offerId: string;
  title: string;
  venueName: string | null;
  priceMinor: number;
  currency: string;
  remaining: number;
}

export function GiftForm({ options }: { options: GiftableOption[] }) {
  const [state, submit, pending] = useActionState<CreateGiftState, FormData>(createGiftAction, {
    status: 'idle',
  });

  if (state.status === 'created') {
    return (
      <Card>
        <div className="stack stack-4">
          <div>
            <p className="eyebrow">Bought for {state.recipientLabel}</p>
            <h2 className="h2">{state.title}</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              {formatMoney(state.amountMinor, state.currency)} · claimable until{' '}
              {new Date(state.expiresAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: 'Asia/Kolkata',
              })}{' '}
              · <span className="mono">{state.publicRef}</span>
            </p>
          </div>

          <Notice tone="warn">
            <span>
              <strong>This claim link is shown once and cannot be recovered.</strong> {BRAND.name} keeps
              only its SHA-256, so nobody — not you, not support — can read it back. Send it to{' '}
              {state.recipientLabel} now. The gift itself is safe either way: the seat is held
              against their name, and it goes back to the venue if it is never claimed.
            </span>
          </Notice>

          <div className="field">
            <label className="label" htmlFor="gift-claim-url">
              The claim link
            </label>
            <input
              className="input input-mono"
              id="gift-claim-url"
              readOnly
              value={state.claimUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="hint">
              Whoever opens it signs in and claims the gift — the booking and its ticket move to
              them, and the seat is never released in between.
            </p>
          </div>

          <Notice tone="info">
            <span>
              {state.contactGiven
                ? `You gave an address. It was hashed on the way in and the plaintext was not stored, so ${BRAND.name} cannot email the link for you — sending it is yours to do. Marking the gift as sent notifies them only if that address already belongs to a ${BRAND.name} account.`
                : `No address was given, so there is nobody for ${BRAND.name} to notify. Sending the link is yours to do.`}
            </span>
          </Notice>

          <p className="small">
            <Link href="/gifts">Back to your gifts</Link>
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form action={submit} className="stack stack-4">
        <h2 className="h3">Buy a gift</h2>

        {state.status === 'error' ? (
          <Notice tone="bad">
            <span role="alert">{state.message}</span>
          </Notice>
        ) : null}

        <div className="field">
          <label className="label" htmlFor="gift-offer">
            Which deal?
          </label>
          <select className="select input" id="gift-offer" name="offerId" required defaultValue="">
            <option value="" disabled>
              Choose a live deal
            </option>
            {options.map((o) => (
              <option key={o.offerId} value={o.offerId}>
                {o.title} — {formatMoney(o.priceMinor, o.currency)}
                {o.venueName ? ` · ${o.venueName}` : ''} · {o.remaining} left
              </option>
            ))}
          </select>
          <p className="hint">
            Only deals that are live now, at a venue with capacity left. The seat is taken the
            moment the gift is created, so nobody can sell it from under the person you bought it
            for.
          </p>
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label className="label" htmlFor="gift-recipient-label">
              Who is it for?
            </label>
            <input
              className="input"
              id="gift-recipient-label"
              name="recipientLabel"
              required
              minLength={2}
              maxLength={80}
              placeholder="Rahul"
              autoComplete="off"
            />
            <p className="hint">A name for your own list. They never see it.</p>
          </div>

          <div className="field">
            <label className="label" htmlFor="gift-recipient">
              Email or mobile <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              className="input"
              id="gift-recipient"
              name="recipient"
              maxLength={120}
              autoComplete="off"
            />
            <p className="hint">Hashed on the way in; the address itself is never stored.</p>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="gift-message">
            Message <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
          </label>
          <textarea
            className="textarea input"
            id="gift-message"
            name="message"
            maxLength={500}
            placeholder="Happy birthday — go and enjoy it."
          />
        </div>

        <div>
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {pending ? <span className="spinner" aria-hidden="true" /> : null}
            Buy the gift
          </Button>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            No money moves: there is no checkout wired in this build, so the booking is confirmed
            against the venue&apos;s capacity with no payment recorded against it. The claim link
            appears on the next screen and is never shown again.
          </p>
        </div>
      </form>
    </Card>
  );
}

export function GiftClaimForm({ initialToken = '' }: { initialToken?: string }) {
  const [state, submit, pending] = useActionState<ClaimGiftState, FormData>(claimGiftAction, {
    status: 'idle',
  });

  if (state.status === 'claimed') {
    return (
      <Card>
        <div className="stack stack-3">
          <Notice tone="ok">
            <span>
              <strong>{state.title} is yours.</strong>{' '}
              {state.ticketsReassigned > 0
                ? `The booking and ${state.ticketsReassigned} ticket${state.ticketsReassigned === 1 ? '' : 's'} moved to you — the seat was never released, so nothing could be sold from under you.`
                : 'The booking moved to you.'}
            </span>
          </Notice>
          <div className="row-wrap">
            {state.bookingRef ? (
              <Link className="btn btn-primary" href={`/bookings/${state.bookingRef}`}>
                Open the booking
              </Link>
            ) : null}
            <Link className="btn" href="/tickets">
              Your tickets
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form action={submit} className="stack stack-3">
        <h2 className="h3">Claim a gift</h2>

        {state.status === 'error' ? (
          <Notice tone="bad">
            <span role="alert">{state.message}</span>
          </Notice>
        ) : null}

        <div className="field">
          <label className="label" htmlFor="gift-claim-token">
            Claim link or token
          </label>
          <input
            className="input input-mono"
            id="gift-claim-token"
            name="claimToken"
            required
            defaultValue={initialToken}
            placeholder="Paste the whole link, or just the token"
            autoComplete="off"
          />
          <p className="hint">
            Whoever holds the link holds the gift, so it is checked rather than looked up: a token
            that does not match gets the same answer as one that never existed.
          </p>
        </div>

        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <span className="spinner" aria-hidden="true" /> : null}
            Claim it
          </Button>
        </div>
      </form>
    </Card>
  );
}
