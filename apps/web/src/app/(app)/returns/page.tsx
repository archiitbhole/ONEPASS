/**
 * Return cases.
 *
 * A return is a conversation with a merchant, so the screen is built around the
 * two things a person actually wants: where the case is, and what the merchant
 * said. The position is drawn by `ReturnStepper`, which derives the route from
 * `RETURN_TRANSITIONS` — the same map `assertTransition` enforces — so what the
 * page shows as possible is exactly what the service will accept.
 *
 * The merchant's note is shown verbatim wherever there is one, and its absence is
 * stated rather than filled in. "Declined" with no reason is a worse experience
 * than "declined, and the merchant has not written anything yet", but inventing a
 * reason would be worse than both.
 *
 * Money: `refundMinor` is the amount the merchant agreed, recorded by the returns
 * module and settled by payments. It is labelled as agreed, not as paid, because
 * this row is not evidence that anything moved.
 *
 * Open cases lead and are given room; finished ones fall back to a ledger. A case
 * nobody can move again is a record, and a record does not need a stepper.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  Empty,
  Money,
  PageHead,
  Stat,
  StatusBadge,
  formatDate,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { ReturnStepper } from '@/components/consumer/return-stepper';
import { labelReason, labelResolution } from '@/components/consumer/return-vocab';
import { RETURN_TRANSITIONS, listReturns } from '@/lib/commerce/returns';
import { currentActor } from '../_queries';

export const metadata: Metadata = {
  title: 'Returns',
  description: 'Every return you have opened, where it sits and what the merchant said.',
};

export const dynamic = 'force-dynamic';

type Row = Awaited<ReturnType<typeof listReturns>>[number];

function OpenCase({ row, now }: { row: Row; now: Date }) {
  const { request, line, receipt, organization } = row;

  return (
    <Card as="li" className="stack stack-4">
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 'var(--s-3)' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <h3 className="h3">{line?.description ?? 'Item no longer on the receipt'}</h3>
          <p className="small muted" style={{ marginTop: 2 }}>
            {organization?.name ?? 'Merchant not recorded'}
            {receipt ? (
              <>
                {' · '}
                <Link href={`/receipts/${receipt.publicRef}`}>{receipt.publicRef}</Link>
              </>
            ) : null}
          </p>
          <p className="tiny mono muted" style={{ marginTop: 4 }}>
            {request.publicRef}
          </p>
        </div>
        <div className="stack stack-2" style={{ alignItems: 'flex-end' }}>
          <StatusBadge status={request.state} />
          <Badge tone="neutral">
            {request.quantity} unit{request.quantity === 1 ? '' : 's'}
          </Badge>
        </div>
      </div>

      <ReturnStepper state={request.state} />

      <div className="grid grid-2">
        <div>
          <p className="eyebrow">You asked for</p>
          <p className="small" style={{ marginTop: 4 }}>
            {labelResolution(request.requestedResolution)} — {labelReason(request.reasonCode)}
          </p>
          {request.reasonNote ? (
            <p className="tiny muted" style={{ marginTop: 4 }}>
              “{request.reasonNote}”
            </p>
          ) : null}
        </div>

        <div>
          <p className="eyebrow">The merchant</p>
          {request.decidedAt ? (
            <>
              <p className="small" style={{ marginTop: 4 }}>
                {request.grantedResolution
                  ? `Granted ${labelResolution(request.grantedResolution).toLowerCase()}`
                  : 'Declined'}{' '}
                on {formatDate(request.decidedAt)}
              </p>
              {request.refundMinor !== null ? (
                <p className="small" style={{ marginTop: 4 }}>
                  Refund agreed: <Money minor={request.refundMinor} />
                  <span className="tiny muted" style={{ display: 'block' }}>
                    Agreed by the merchant and settled by payments — this line is the decision, not the transfer.
                  </span>
                </p>
              ) : null}
              <p className="tiny muted" style={{ marginTop: 4 }}>
                {request.merchantNote ? `“${request.merchantNote}”` : 'No note was left with the decision.'}
              </p>
            </>
          ) : (
            <p className="small muted" style={{ marginTop: 4 }}>
              No decision yet. Opened {formatRelative(request.createdAt, now)}.
            </p>
          )}
        </div>
      </div>

      <p className="tiny muted">
        Opened {formatDateTime(request.createdAt)} · the return window on that purchase{' '}
        {request.windowClosesAt.getTime() < now.getTime() ? 'closed' : 'closes'} {formatDate(request.windowClosesAt)}
      </p>
    </Card>
  );
}

export default async function ReturnsPage() {
  const actor = await currentActor();
  const now = new Date();
  const rows = await listReturns({ userId: actor.userId, limit: 100 });

  const open = rows.filter((r) => RETURN_TRANSITIONS[r.request.state].length > 0);
  const settled = rows.filter((r) => RETURN_TRANSITIONS[r.request.state].length === 0);
  const awaitingMerchant = rows.filter(
    (r) => r.request.state === 'REQUESTED' || r.request.state === 'UNDER_REVIEW',
  );
  const agreedMinor = settled.reduce((sum, r) => sum + (r.request.refundMinor ?? 0), 0);

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Cases"
        title="Returns"
        lede={
          rows.length > 0
            ? `${rows.length} case${rows.length === 1 ? '' : 's'} on this account.`
            : 'Returns you open from a receipt are tracked here until they are closed.'
        }
        actions={
          <ButtonLink href="/receipts" size="sm" variant="ghost">
            Open one from a receipt
          </ButtonLink>
        }
      />

      {rows.length > 0 ? (
        <section className="stat-row" aria-label="Cases at a glance">
          <Stat label="Open" value={open.length} hint="Still able to move to another state." />
          <Stat
            label="With the merchant"
            value={awaitingMerchant.length}
            tone={awaitingMerchant.length > 0 ? 'warn' : undefined}
            hint={
              awaitingMerchant.length > 0
                ? 'Waiting on a decision. Only the merchant can move these on.'
                : 'Nothing is waiting on a merchant decision.'
            }
          />
          <Stat
            label="Agreed on closed cases"
            value={<Money minor={agreedMinor} />}
            tone="value"
            hint="What merchants agreed to refund. Whether it has reached you is a payment, not a case."
          />
        </section>
      ) : null}

      <section className="stack stack-4" aria-labelledby="open-heading">
        <div className="section-head">
          <h2 id="open-heading">Open</h2>
        </div>
        {open.length > 0 ? (
          <ul className="stack stack-4">
            {open.map((row) => (
              <OpenCase key={row.request.id} row={row} now={now} />
            ))}
          </ul>
        ) : (
          <Card>
            <Empty
              title={rows.length > 0 ? 'Nothing open' : 'No returns open'}
              body={
                rows.length > 0
                  ? 'Every case on this account has reached a final state.'
                  : 'A return starts on the receipt for the thing you want to send back — open the receipt and use the return form on the line.'
              }
              action={
                rows.length > 0 ? undefined : (
                  <ButtonLink href="/receipts" variant="primary">
                    Go to receipts
                  </ButtonLink>
                )
              }
            />
          </Card>
        )}
      </section>

      {settled.length > 0 ? (
        <section className="stack stack-4" aria-labelledby="closed-heading">
          <div className="section-head">
            <h2 id="closed-heading">Closed</h2>
          </div>
          <Card>
            <ul className="ledger">
              {settled.map(({ request, line, organization }) => (
                <li key={request.id}>
                  <span className="ledger-main">
                    <span className="ledger-title">{line?.description ?? 'Item no longer on the receipt'}</span>
                    <span className="ledger-meta">
                      {organization?.name ?? 'Merchant not recorded'} · <span className="mono">{request.publicRef}</span>{' '}
                      · {request.decidedAt ? `decided ${formatDate(request.decidedAt)}` : 'never decided'}
                    </span>
                  </span>
                  <span className="row-wrap">
                    {request.refundMinor !== null ? (
                      <span className="ledger-figure">
                        <Money minor={request.refundMinor} />
                      </span>
                    ) : null}
                    <StatusBadge status={request.state} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <section className="stack stack-3" aria-labelledby="machine-heading">
        <div className="section-head">
          <h2 id="machine-heading">How a case moves</h2>
        </div>
        <Card className="card-flat stack stack-3">
          <p className="small muted">
            These are the only moves the returns service accepts. A request is picked up for review before it can be
            decided, so &ldquo;under review&rdquo; means a person has it rather than that it has vanished into a
            queue.
          </p>
          <ul className="ledger">
            {(Object.keys(RETURN_TRANSITIONS) as (keyof typeof RETURN_TRANSITIONS)[]).map((from) => (
              <li key={from}>
                {/* Not `.ledger-main`: that is a column that stretches its child
                    to the full width, which turns a badge into a banner. */}
                <span className="row-wrap" style={{ flex: '0 0 auto' }}>
                  <StatusBadge status={from} />
                </span>
                <span className="row-wrap" style={{ justifyContent: 'flex-end', flex: '1 1 auto' }}>
                  {RETURN_TRANSITIONS[from].length > 0 ? (
                    RETURN_TRANSITIONS[from].map((to) => (
                      <span key={to} className="badge badge-neutral">
                        {to.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    ))
                  ) : (
                    <span className="tiny muted">final</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
