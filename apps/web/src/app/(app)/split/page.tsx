/**
 * Splits — what you organised, and what you owe a share of.
 *
 * `listSplits` returns both sides of the relationship in one call and already
 * carries the outstanding total per split, summed from the shares that are still
 * PENDING or DECLINED. Nothing on this page recomputes it: a declined share is
 * still money the organiser is out of pocket for, and the service is the one
 * place that decides so.
 *
 * The only client code here is the create form, which needs local state for its
 * participant rows and — more importantly — is the one place the claim tokens
 * exist after the transaction. See the note at the top of `actions.ts`.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Card,
  Empty,
  Notice,
  PageHead,
  Stat,
  StatusBadge,
  TableScroll,
  formatDate,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { SplitForm } from '@/components/consumer/split-form';
import { listSplits, type SplitView } from '@/lib/commerce/split';
import { currentActor } from '../_queries';

export const metadata: Metadata = {
  title: 'Split a bill',
  description: 'Group payments you organised and the shares you owe, with what is still outstanding.',
};

export const dynamic = 'force-dynamic';

const METHOD_LABELS: Record<string, string> = {
  EQUAL: 'Equal shares',
  BY_AMOUNT: 'Set amounts',
  BY_SHARE: 'Weighted shares',
};

function SplitTable({ splits, caption }: { splits: SplitView[]; caption: string }) {
  return (
    <TableScroll>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">What for</th>
            <th scope="col">State</th>
            <th scope="col" className="table-num">
              Total
            </th>
            <th scope="col" className="table-num">
              Settled
            </th>
            <th scope="col" className="table-num">
              Outstanding
            </th>
          </tr>
        </thead>
        <tbody>
          {splits.map((split) => (
            <tr key={split.publicRef}>
              <td>
                <Link href={`/split/${split.publicRef}`}>{split.title}</Link>
                <span className="tiny muted" style={{ display: 'block' }}>
                  {METHOD_LABELS[split.method] ?? split.method} · started {formatRelative(split.createdAt)}
                  {split.expiresAt ? ` · expires ${formatDate(split.expiresAt)}` : ''}
                </span>
              </td>
              <td>
                <StatusBadge status={split.state} />
              </td>
              <td className="table-num">{formatMoney(split.totalMinor, split.currency)}</td>
              <td className="table-num">{formatMoney(split.settledMinor, split.currency)}</td>
              <td className="table-num">
                {split.outstandingMinor > 0 ? (
                  formatMoney(split.outstandingMinor, split.currency)
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export default async function SplitPage() {
  const actor = await currentActor();
  const { organised, participating } = await listSplits({ userId: actor.userId, limit: 60 });

  const owedToYou = organised.reduce((sum, s) => sum + s.outstandingMinor, 0);
  const openOrganised = organised.filter((s) => s.state === 'OPEN' || s.state === 'PARTIAL').length;

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Group payments"
        title="Split a bill"
        lede={
          <>
            One amount, several people, and a record of who has settled. A split is an agreement
          about who owes what — it is not a second ledger, so no money moves here.
          </>
        }
      />

      <section className="stat-row" aria-label="Where your splits stand">
        <Stat
          label="Still owed to you"
          value={formatMoney(owedToYou)}
          hint={
            organised.length > 0
              ? `Across ${openOrganised} split${openOrganised === 1 ? '' : 's'} you organised that are still open.`
              : 'Nothing you have organised is outstanding.'
          }
        />
        <Stat
          label="You organised"
          value={organised.length}
          hint="You set the total and decide what happens to a share nobody pays."
        />
        <Stat
          label="You are in"
          value={participating.length}
          hint="Splits somebody else started that carry a share in your name."
        />
      </section>

      <section className="stack stack-3" aria-labelledby="you-organised-heading">
        <div className="section-head">
          <h2 id="you-organised-heading">You organised</h2>
        </div>
        {organised.length > 0 ? (
          <Card>
            <SplitTable splits={organised} caption="Splits you organised, newest first" />
          </Card>
        ) : (
          <Card>
            <Empty
              title="You have not started a split"
              body="Start one below: a title, the total, how it divides and who is in it."
            />
          </Card>
        )}
      </section>

      <section className="stack stack-3" aria-labelledby="your-share-of-someone-else-s-heading">
        <div className="section-head">
          <h2 id="your-share-of-someone-else-s-heading">Your share of someone else’s</h2>
        </div>
        {participating.length > 0 ? (
          <Card>
            <SplitTable splits={participating} caption="Splits you owe a share of" />
          </Card>
        ) : (
          <Card>
            <Empty
              title="Nobody has put you in a split"
              body="A share appears here once it is claimed in your name. Until then a share belongs to whoever holds its claim token."
            />
          </Card>
        )}
      </section>

      <section className="stack stack-3" aria-labelledby="start-a-split-heading">
        <div className="section-head">
          <h2 id="start-a-split-heading">Start a split</h2>
        </div>
        <SplitForm organiserLabel={actor.displayName} />
      </section>

      <Notice tone="info">
        <span>
          Paying a share needs a captured payment to point at, and there is no checkout wired in
          this build — so a share is settled by the organiser waiving it, or not at all for now.
          Everything else here is real: the shares are written to sum to exactly the total, and
          the settled figure is summed from the shares every time one moves.
        </span>
      </Notice>
    </div>
  );
}
