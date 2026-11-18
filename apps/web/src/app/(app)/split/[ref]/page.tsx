/**
 * One split, share by share.
 *
 * `getSplit` refuses anyone who is neither the organiser nor a participant, and
 * refuses with "not found" rather than "forbidden" — so a guessed public
 * reference cannot be used to confirm that a split exists. This page turns that
 * refusal into a 404 and does not re-check the rule itself.
 *
 * Two things it is careful about:
 *
 *  · A control is only drawn when the service would accept it. Reminding is
 *    capped at one nudge every twelve hours, so a share reminded an hour ago
 *    gets a sentence saying when the next one may go, not a button that would
 *    come back with a refusal.
 *  · Paying a share needs a captured transaction to point at, and there is no
 *    checkout in this build. So there is no pay button — there is a sentence
 *    saying why, which is the honest version of the same information.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHead,
  DefinitionList,
  Notice,
  PageHead,
  Stat,
  StatusBadge,
  TableScroll,
  formatDateTime,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { REMIND_INTERVAL_HOURS, getSplit, type ShareView } from '@/lib/commerce/split';
import { AppError } from '@/lib/errors';
import { currentActor, splitOrganiserId } from '../../_queries';
import { declineShareAction, remindShareAction, waiveShareAction } from '../actions';

export const metadata: Metadata = {
  title: 'Split',
  description: 'Every share of one split, who owes what, and what is still outstanding.',
};

export const dynamic = 'force-dynamic';

const METHOD_LABELS: Record<string, string> = {
  EQUAL: 'Equal shares',
  BY_AMOUNT: 'Set amounts',
  BY_SHARE: 'Weighted shares',
};

/** The twelve-hour cap, read off the share rather than a counter somewhere else. */
function remindableIn(share: ShareView, now: Date): number {
  if (!share.remindedAt) return 0;
  const elapsed = (now.getTime() - share.remindedAt.getTime()) / 3_600_000;
  return Math.max(0, Math.ceil(REMIND_INTERVAL_HOURS - elapsed));
}

export default async function SplitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const actor = await currentActor();
  const { ref } = await params;
  const query = await searchParams;

  let found: Awaited<ReturnType<typeof getSplit>>;
  try {
    found = await getSplit({ publicRef: ref, userId: actor.userId });
  } catch (err) {
    if (err instanceof AppError && err.code === 'NOT_FOUND') notFound();
    throw err;
  }

  const { split, shares, outstandingMinor } = found;
  const isOrganiser = (await splitOrganiserId(split.publicRef)) === actor.userId;
  const now = new Date();
  const finished = split.state === 'CANCELLED' || split.state === 'EXPIRED';

  return (
    <div className="wrap stack stack-5">
      <p className="small">
        <Link href="/split">← Every split</Link>
      </p>

      <PageHead
        eyebrow={isOrganiser ? 'You organised this' : 'Your share'}
        title={split.title}
        lede={split.note}
      />

      {query.done ? <Notice tone="ok">{query.done}</Notice> : null}
      {query.error ? (
        <Notice tone="bad">
          <span role="alert">{query.error}</span>
        </Notice>
      ) : null}

      <section className="stat-row" aria-label="The money">
        <Stat label="Total" value={formatMoney(split.totalMinor, split.currency)} hint="What the shares add up to, exactly." />
        <Stat
          label="Settled"
          value={formatMoney(split.settledMinor, split.currency)}
          hint="Summed from the paid shares each time one moves — never incremented."
        />
        <Stat
          label="Outstanding"
          value={formatMoney(outstandingMinor, split.currency)}
          tone={outstandingMinor > 0 ? 'warn' : 'ok'}
          hint="Pending and declined shares. A decline does not make the amount go away."
        />
      </section>

      <section>
        <CardHead
          title="Shares"
          action={<span className="small muted">{shares.length} in this split</span>}
        />
        <Card>
          <TableScroll>
            <table className="table">
              <caption className="sr-only">Every share of this split and its state</caption>
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">State</th>
                  <th scope="col" className="table-num">
                    Owes
                  </th>
                  <th scope="col">Last moved</th>
                  {isOrganiser || shares.some((s) => s.isYou) ? <th scope="col">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => {
                  const waitHours = remindableIn(share, now);
                  const canRemind = isOrganiser && !finished && share.state === 'PENDING' && waitHours === 0;
                  const canWaive =
                    isOrganiser && !finished && (share.state === 'PENDING' || share.state === 'DECLINED');
                  const canDecline = share.isYou && !finished && share.state === 'PENDING';

                  return (
                    <tr key={share.id}>
                      <td>
                        {share.displayLabel}
                        {share.isYou ? (
                          <>
                            {' '}
                            <Badge tone="accent">you</Badge>
                          </>
                        ) : null}
                        {split.method === 'BY_SHARE' ? (
                          <span className="tiny muted" style={{ display: 'block' }}>
                            {share.shareUnits} share{share.shareUnits === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <StatusBadge status={share.state} />
                      </td>
                      <td className="table-num">{formatMoney(share.amountMinor, split.currency)}</td>
                      <td className="small muted">
                        {share.paidAt
                          ? `paid ${formatRelative(share.paidAt)}`
                          : share.remindedAt
                            ? `reminded ${formatRelative(share.remindedAt)}`
                            : '—'}
                      </td>

                      {isOrganiser || shares.some((s) => s.isYou) ? (
                        <td>
                          <div className="row-wrap">
                            {canRemind ? (
                              <form action={remindShareAction}>
                                <input type="hidden" name="splitRef" value={split.publicRef} />
                                <input type="hidden" name="shareId" value={share.id} />
                                <Button type="submit" size="sm">
                                  Remind
                                </Button>
                              </form>
                            ) : null}

                            {canWaive ? (
                              <form action={waiveShareAction}>
                                <input type="hidden" name="splitRef" value={split.publicRef} />
                                <input type="hidden" name="shareId" value={share.id} />
                                <Button type="submit" size="sm" variant="ghost">
                                  Waive
                                </Button>
                              </form>
                            ) : null}

                            {canDecline ? (
                              <form action={declineShareAction}>
                                <input type="hidden" name="splitRef" value={split.publicRef} />
                                <input type="hidden" name="shareId" value={share.id} />
                                <Button type="submit" size="sm" variant="ghost">
                                  Not mine
                                </Button>
                              </form>
                            ) : null}

                            {isOrganiser && share.state === 'PENDING' && waitHours > 0 ? (
                              <span className="tiny muted">
                                Nudged recently — another can go in about {waitHours} hour
                                {waitHours === 1 ? '' : 's'}.
                              </span>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </section>

      <section>
        <CardHead title="This split" />
        <Card>
          <DefinitionList
            items={[
              ['Started', formatDateTime(split.createdAt)],
              ['Divided', METHOD_LABELS[split.method] ?? split.method],
              ['Expires', split.expiresAt ? formatDateTime(split.expiresAt) : 'No expiry set'],
              ['Settled', split.settledAt ? formatDateTime(split.settledAt) : 'Not yet'],
              ['Reference', <span key="reference" className="mono">{split.publicRef}</span>],
            ]}
          />
        </Card>
      </section>

      <Notice tone="info">
        <span>
          <strong>There is no pay button, on purpose.</strong> A share is settled against a
          captured payment — the same transaction row every other purchase uses — and no checkout
          is wired in this build, so there is nothing for a share to point at. Waiving is the one
          way an amount stops being outstanding today, and it records that{' '}
          {isOrganiser ? 'you are' : 'the organiser is'} covering it rather than that anybody paid.
        </span>
      </Notice>

      {!isOrganiser ? (
        <p className="small muted">
          Reminding and waiving belong to whoever organised this split.{' '}
          <ButtonLink href="/split" size="sm">
            Your splits
          </ButtonLink>
        </p>
      ) : null}
    </div>
  );
}
