/**
 * Gifts — what you sent, what you were sent, and what happens next.
 *
 * A gift is a booking that has already been paid for and is waiting for its
 * holder: the capacity is taken and confirmed when the gift is bought, and
 * claiming reassigns that booking rather than issuing a new one. So the state on
 * each row is the gift's own — PAID, DELIVERED, CLAIMED, EXPIRED — and the
 * expiry beside it is the date the seat goes back to the venue.
 *
 * `listGifts` never returns a claim token. It cannot: only the SHA-256 is
 * stored, and the plaintext existed for one render on the screen that created
 * it. That is said out loud below, because "where did my link go" is otherwise a
 * support ticket.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHead,
  Empty,
  Notice,
  PageHead,
  Stat,
  TableScroll,
  formatDate,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { GiftClaimForm, GiftForm, type GiftableOption } from '@/components/consumer/gift-forms';
import { listGifts } from '@/lib/commerce/gifts';
import { currentActor, giftableOffers } from '../_queries';
import { deliverGiftAction } from './actions';

export const metadata: Metadata = {
  title: 'Gifts',
  description: 'Experiences you have sent and been sent, with their state and when they expire.',
};

export const dynamic = 'force-dynamic';

const GIFT_STATE_TONES: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'accent'> = {
  PAID: 'info',
  DELIVERED: 'warn',
  CLAIMED: 'ok',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  REFUNDED: 'info',
};

function GiftState({ state }: { state: string }) {
  return (
    <Badge tone={GIFT_STATE_TONES[state] ?? 'neutral'} dot>
      {state.toLowerCase()}
    </Badge>
  );
}

export default async function GiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string; done?: string; error?: string }>;
}) {
  const actor = await currentActor();
  const query = await searchParams;

  const [{ sent, received }, offers] = await Promise.all([
    listGifts({ userId: actor.userId, limit: 60 }),
    giftableOffers(),
  ]);

  const options: GiftableOption[] = offers.map((o) => ({
    offerId: o.offerId,
    title: o.title,
    venueName: o.venueName,
    priceMinor: o.priceMinor,
    currency: o.currency,
    remaining: o.remaining,
  }));

  const awaitingClaim = sent.filter((g) => g.state === 'PAID' || g.state === 'DELIVERED').length;
  const claimedByMe = received.filter((g) => g.state === 'CLAIMED').length;

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Send an experience"
        title="Gifts"
        lede={
          <>
            A gift is a seat that is already paid for and waiting for its holder. Claiming one moves
          the booking and its tickets across — the capacity is never released in between.
          </>
        }
      />

      {query.done ? <Notice tone="ok">{query.done}</Notice> : null}
      {query.error ? (
        <Notice tone="bad">
          <span role="alert">{query.error}</span>
        </Notice>
      ) : null}

      <section className="stat-row" aria-label="Your gifts at a glance">
        <Stat
          label="Waiting to be claimed"
          value={awaitingClaim}
          hint={
            awaitingClaim > 0
              ? 'The seat is held for them until the gift expires, then it goes back to the venue.'
              : 'Nothing you have sent is still outstanding.'
          }
        />
        <Stat label="You sent" value={sent.length} hint="Every gift bought from this account." />
        <Stat
          label="You were sent"
          value={received.length}
          hint={claimedByMe > 0 ? `${claimedByMe} of them claimed.` : 'A gift lands here once you claim it.'}
        />
      </section>

      <section className="stack stack-3" aria-labelledby="claim-a-gift-heading">
        <div className="section-head">
          <h2 id="claim-a-gift-heading">Claim a gift</h2>
        </div>
        <GiftClaimForm {...(query.claim ? { initialToken: query.claim } : {})} />
      </section>

      <section className="stack stack-3" aria-labelledby="sent-to-you-heading">
        <div className="section-head">
          <h2 id="sent-to-you-heading">Sent to you</h2>
        </div>
        {received.length > 0 ? (
          <Card>
            <TableScroll>
              <table className="table">
                <caption className="sr-only">Gifts you have claimed or been sent</caption>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">State</th>
                    <th scope="col" className="table-num">
                      Worth
                    </th>
                    <th scope="col">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {received.map((gift) => (
                    <tr key={gift.publicRef}>
                      <td>
                        {gift.title}
                        <span className="tiny muted" style={{ display: 'block' }}>
                          {gift.venueName ?? 'No venue on this gift'}
                          {gift.message ? ` · “${gift.message}”` : ''}
                        </span>
                      </td>
                      <td>
                        <GiftState state={gift.state} />
                      </td>
                      <td className="table-num">{formatMoney(gift.amountMinor, gift.currency)}</td>
                      <td className="small muted">
                        {gift.claimedAt
                          ? `claimed ${formatRelative(gift.claimedAt)}`
                          : `${formatDate(gift.expiresAt)} · ${formatRelative(gift.expiresAt)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="tiny muted" style={{ marginTop: 12 }}>
              A claimed gift is an ordinary booking from that moment — it is in{' '}
              <Link href="/bookings">your bookings</Link> and its ticket is in{' '}
              <Link href="/tickets">your wallet</Link>.
            </p>
          </Card>
        ) : (
          <Card>
            <Empty
              title="Nobody has sent you one"
              body="A gift only appears here after you claim it, because until then it belongs to whoever holds the link. If you were sent a link, paste it above."
            />
          </Card>
        )}
      </section>

      <section className="stack stack-3" aria-labelledby="you-sent-heading">
        <div className="section-head">
          <h2 id="you-sent-heading">You sent</h2>
        </div>
        {sent.length > 0 ? (
          <Card>
            <TableScroll>
              <table className="table">
                <caption className="sr-only">Gifts you have bought, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">For</th>
                    <th scope="col">State</th>
                    <th scope="col" className="table-num">
                      Paid
                    </th>
                    <th scope="col">Expires</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sent.map((gift) => (
                    <tr key={gift.publicRef}>
                      <td>
                        {gift.title}
                        <span className="tiny mono muted" style={{ display: 'block' }}>
                          {gift.publicRef}
                        </span>
                      </td>
                      <td>
                        {gift.recipientLabel}
                        {gift.venueName ? (
                          <span className="tiny muted" style={{ display: 'block' }}>
                            {gift.venueName}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <GiftState state={gift.state} />
                        {gift.deliveredAt ? (
                          <span className="tiny muted" style={{ display: 'block' }}>
                            sent {formatRelative(gift.deliveredAt)}
                          </span>
                        ) : null}
                      </td>
                      <td className="table-num">{formatMoney(gift.amountMinor, gift.currency)}</td>
                      <td className="small muted">
                        {gift.claimedAt
                          ? `claimed ${formatRelative(gift.claimedAt)}`
                          : formatDate(gift.expiresAt)}
                      </td>
                      <td>
                        {gift.state === 'PAID' ? (
                          <form action={deliverGiftAction}>
                            <input type="hidden" name="giftRef" value={gift.publicRef} />
                            <Button type="submit" size="sm">
                              Mark as sent
                            </Button>
                          </form>
                        ) : (
                          <span className="tiny muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            <Notice tone="info">
              <span>
                The claim link for each of these was shown once, on the screen that created it,
                and is not recoverable — only its SHA-256 is stored. If a link is lost the gift
                cannot be handed over; it expires and the seat goes back to the venue.
              </span>
            </Notice>
          </Card>
        ) : (
          <Card>
            <Empty
              title="You have not sent a gift"
              body="Pick a live deal below, say who it is for, and you get a claim link to pass on."
            />
          </Card>
        )}
      </section>

      <section>
        <CardHead
          title="Buy a gift"
          action={
            options.length > 0 ? (
              <span className="small muted">
                {options.length} deal{options.length === 1 ? '' : 's'} with capacity left
              </span>
            ) : null
          }
        />
        {options.length > 0 ? (
          <GiftForm options={options} />
        ) : (
          <Card>
            <Empty
              title="No deal can be gifted right now"
              body="A gift takes real capacity, so it needs a deal that is live, has not ended and still has places on it. None does at the moment."
              action={
                <ButtonLink href="/deals" variant="primary">
                  See what is live
                </ButtonLink>
              }
            />
          </Card>
        )}
      </section>
    </div>
  );
}
