/**
 * The wallet: what you hold, and what your points are worth.
 *
 * Two halves, in that order. First the collection — credentials, tickets,
 * things you own, cover, receipts — because that is what a wallet is: a set of
 * valuable objects, each of a different kind, not a list of rows. Then the
 * points, read as a statement.
 *
 * The credential shelf is the holder's own view of what has been issued to
 * them. It shows the type, the issuer and whether it is still good; the claims
 * themselves are on the credential's own page, which is where a person chooses
 * to reveal them.
 *
 *
 * `reward_accounts.balance` is a cache; `reward_ledger` is the truth. So the top of
 * this page shows the cached balances — that is what a redemption is checked
 * against — and the statement below shows the entries that produced them, each with
 * its own signed amount, its reason and the balance that resulted.
 *
 * The one thing a statement has to get right is which account a running balance
 * belongs to. `balanceAfter` is the balance of *that entry's account*, so with more
 * than one issuer the numbers only make sense once each row says whose account it
 * is — otherwise a perfectly correct column looks like it jumps. Hence the account
 * column, and hence `rewardAccountIssuers`.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ButtonLink,
  Card,
  Empty,
  Notice,
  PageHead,
  Stack,
  Stat,
  TableScroll,
  formatDate,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { Glyph, type GlyphName } from '@/components/icons';
import { Certificate } from '@/components/objects';
import { DEFAULT_PAISE_PER_POINT, ledgerFor, walletSummary } from '@/lib/commerce/rewards';
import { listHolderCredentials } from '@/lib/credentials/service';
import { listTickets } from '@/lib/commerce/tickets';
import { listWarranties } from '@/lib/commerce/warranties';
import { receiptSummary } from '@/lib/commerce/receipts';
import { listOwnedProducts } from '@/lib/products/ownership';
import { currentActor, organizationNames, rewardAccountIssuers } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Wallet',
  description: 'Your points balance, who issued them, and every entry that moved them.',
};

export const dynamic = 'force-dynamic';

const NETWORK_ACCOUNT = `${BRAND.name} network`;

/** The ledger's own words, rendered without softening what they mean. */
const KIND_LABELS: Record<string, string> = {
  EARN_PURCHASE: 'Earned on a purchase',
  EARN_BONUS: 'Bonus',
  EARN_QUEST: 'Challenge completed',
  EARN_REFERRAL: 'Referral',
  REDEEM_OFFER: 'Redeemed on an offer',
  REDEEM_TRANSFER: 'Redeemed at another partner',
  EXPIRE: 'Expired',
  ADJUST_CREDIT: 'Adjustment — credit',
  ADJUST_DEBIT: 'Adjustment — debit',
  REVERSAL: 'Reversal',
};

interface Counts {
  credentials: number;
  tickets: number;
  products: number;
  warranties: number;
  receipts: number;
  receiptTotalMinor: number;
}

/**
 * The collection, as counts of real rows.
 *
 * Each tile is a different kind of thing rather than the same card six times:
 * a credential is not a receipt, and a wallet that flattens them into
 * identical rows is a database view, not a wallet.
 */
const HOLDINGS: {
  href: string;
  label: string;
  glyph: GlyphName;
  count: (c: Counts) => number;
  note: (c: Counts) => string;
}[] = [
  {
    href: '/tickets',
    label: 'Tickets',
    glyph: 'ticket',
    count: (c) => c.tickets,
    note: (c) => (c.tickets > 0 ? 'still to use' : 'nothing booked yet'),
  },
  {
    href: '/products',
    label: 'Things you own',
    glyph: 'product',
    count: (c) => c.products,
    note: (c) => (c.products > 0 ? 'yours to give or sell' : 'bought goods appear here'),
  },
  {
    href: '/warranties',
    label: 'Cover',
    glyph: 'shield',
    count: (c) => c.warranties,
    note: (c) => (c.warranties > 0 ? 'warranties still running' : 'no cover running'),
  },
  {
    href: '/receipts',
    label: 'Receipts',
    glyph: 'receipt',
    count: (c) => c.receipts,
    note: (c) => (c.receipts > 0 ? 'in the last twelve months' : 'purchases appear here'),
  },
];

export default async function WalletPage() {
  const actor = await currentActor();

  const [wallet, entries, accountIssuers, credentials, upcoming, warranties, products, receipts] =
    await Promise.all([
      walletSummary(actor.userId),
      ledgerFor(actor.userId, 100),
      rewardAccountIssuers(actor.userId),
      listHolderCredentials(actor.userId, 12),
      listTickets({ userId: actor.userId, upcoming: true, limit: 50 }),
      listWarranties({ userId: actor.userId, status: 'ACTIVE', limit: 50 }),
      listOwnedProducts(actor.userId),
      receiptSummary(actor.userId),
    ]);

  const names = await organizationNames([
    ...wallet.accounts.map((a) => a.issuerOrganizationId),
    ...entries.map((e) => e.counterpartyOrganizationId),
    ...accountIssuers.values(),
  ]);

  const accountLabel = (accountId: string): string => {
    const issuer = accountIssuers.get(accountId);
    if (issuer === undefined) return 'Account not on this profile';
    return issuer === null ? NETWORK_ACCOUNT : (names.get(issuer) ?? 'Partner');
  };

  const counts: Counts = {
    credentials: credentials.length,
    tickets: upcoming.length,
    products: products.length,
    warranties: warranties.length,
    receipts: receipts.receiptCount,
    receiptTotalMinor: receipts.totalMinor,
  };

  const lifetimeEarned = wallet.accounts.reduce((sum, a) => sum + a.lifetimeEarned, 0);
  const lifetimeRedeemed = wallet.accounts.reduce((sum, a) => sum + a.lifetimeRedeemed, 0);
  const multipleAccounts = wallet.accounts.length > 1;

  return (
    <div className="wrap">
      <Stack gap={6}>
        <PageHead
          eyebrow="What you hold"
          title="Wallet"
          lede="Your credentials, tickets, cover and receipts — and the points partners have issued you, with the entry behind every movement."
        />

        <section aria-labelledby="holdings-heading" className="stack stack-4">
          <div className="section-head">
            <h2 id="holdings-heading">Your collection</h2>
          </div>
          <div className="holdings">
            {HOLDINGS.map((h) => (
              <Link key={h.href} href={h.href} className="holding">
                <span className="holding-mark" aria-hidden="true">
                  <Glyph name={h.glyph} size={20} />
                </span>
                <span className="holding-count">{h.count(counts).toLocaleString('en-IN')}</span>
                <span className="holding-label">{h.label}</span>
                <span className="holding-note">{h.note(counts)}</span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="credentials-heading" className="stack stack-4">
          <div className="section-head">
            <h2 id="credentials-heading">Credentials</h2>
            <Link className="small" href="/verify">
              Check one
            </Link>
          </div>
          {credentials.length > 0 ? (
            <ul className="shelf">
              {credentials.map((c) => {
                const lapsed = c.validUntil !== null && c.validUntil.getTime() < Date.now();
                const tone = c.status === 'ACTIVE' && !lapsed ? 'ok' : c.status === 'REVOKED' ? 'bad' : 'neutral';
                return (
                  <li key={c.publicRef}>
                    <Certificate seed={c.publicRef}>
                      <div className="stack stack-3">
                        <div className="row" style={{ alignItems: 'flex-start' }}>
                          <Certificate.Seal />
                          <div className="stack stack-1" style={{ minWidth: 0 }}>
                            <p className="eyebrow">{c.category.replace(/_/g, ' ').toLowerCase()}</p>
                            <h3 className="h3">{c.typeName}</h3>
                            <p className="small muted">
                              Issued by {c.issuer} · {formatDate(c.issuedAt)}
                            </p>
                          </div>
                        </div>
                        <div className="row-between">
                          <span className={`badge badge-${tone}`}>
                            {lapsed && c.status === 'ACTIVE' ? 'expired' : c.status.toLowerCase()}
                          </span>
                          <Link className="small" href={`/v/${c.publicRef}`}>
                            Open and verify →
                          </Link>
                        </div>
                      </div>
                    </Certificate>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Card>
              <Empty
                title="No credentials yet"
                body="A membership, a student card or a staff pass issued to you by a partner appears here, signed by them and checkable by anyone you show it to."
                action={<ButtonLink href="/verify">Verify someone else’s</ButtonLink>}
              />
            </Card>
          )}
        </section>

        <section aria-labelledby="points-heading" className="stack stack-4">
          <div className="section-head">
            <h2 id="points-heading">Points</h2>
            <Link className="small" href="/savings">
              Money saved
            </Link>
          </div>
        <section className="grid grid-3" aria-label="Balance">
          <Stat
            label="Points balance"
            value={wallet.totalPoints.toLocaleString('en-IN')}
            hint={
              wallet.totalPoints > 0
                ? `About ${formatMoney(wallet.totalValueMinor)} at the platform rate of ${DEFAULT_PAISE_PER_POINT} paise a point.`
                : 'Points are credited when a purchase is captured.'
            }
          />
          <Stat
            label="Earned, all time"
            value={lifetimeEarned.toLocaleString('en-IN')}
            hint="Across every account on this profile."
          />
          <Stat
            label="Redeemed, all time"
            value={lifetimeRedeemed.toLocaleString('en-IN')}
            hint="Spent at a partner, at that partner’s own rate."
          />
        </section>

        {/* ── per partner ── */}
        <section aria-labelledby="by-partner-heading">
          <div className="section-head">
            <h3 id="by-partner-heading" className="h4">By partner</h3>
          </div>
          {wallet.accounts.length > 0 ? (
            <Card>
              <TableScroll>
                <table className="table">
                  <caption className="sr-only">Points by issuing partner</caption>
                  <thead>
                    <tr>
                      <th scope="col">Issued by</th>
                      <th scope="col" className="table-num">
                        Balance
                      </th>
                      <th scope="col" className="table-num">
                        Earned
                      </th>
                      <th scope="col" className="table-num">
                        Redeemed
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallet.accounts.map((account) => {
                      const label =
                        account.issuerOrganizationId === null
                          ? NETWORK_ACCOUNT
                          : (names.get(account.issuerOrganizationId) ?? 'Partner');
                      return (
                        <tr key={account.issuerOrganizationId ?? 'network'}>
                          <td>
                            {label}
                            {account.issuerOrganizationId === null ? (
                              <span className="tiny muted" style={{ display: 'block' }}>
                                Earned across the network, spendable anywhere that accepts it
                              </span>
                            ) : null}
                          </td>
                          <td className="table-num">{account.balance.toLocaleString('en-IN')}</td>
                          <td className="table-num">{account.lifetimeEarned.toLocaleString('en-IN')}</td>
                          <td className="table-num">{account.lifetimeRedeemed.toLocaleString('en-IN')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </Card>
          ) : (
            <Card>
              <Empty
                title="No reward account yet"
                body="An account is opened the first time a partner credits you — there is nothing to show until then."
                action={
                  <ButtonLink href="/deals" variant="primary">
                    See what is live
                  </ButtonLink>
                }
              />
            </Card>
          )}
        </section>

        {/* ── the statement ── */}
        <section aria-labelledby="statement-heading">
          <div className="section-head">
            <h3 id="statement-heading" className="h4">Statement</h3>
            <span className="small muted">
              {entries.length > 0 ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` : null}
            </span>
          </div>
          {entries.length > 0 ? (
            <Card>
              <TableScroll>
                <table className="table">
                  <caption className="sr-only">Reward ledger, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Description</th>
                      {multipleAccounts ? <th scope="col">Account</th> : null}
                      <th scope="col" className="table-num">
                        Points
                      </th>
                      <th scope="col" className="table-num">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          {formatDate(entry.createdAt)}
                          <span className="tiny muted" style={{ display: 'block' }}>
                            {formatRelative(entry.createdAt)}
                          </span>
                        </td>
                        <td>
                          {entry.description}
                          <span className="tiny muted" style={{ display: 'block' }}>
                            {KIND_LABELS[entry.kind] ?? entry.kind.replace(/_/g, ' ').toLowerCase()}
                            {entry.counterpartyOrganizationId
                              ? ` · at ${names.get(entry.counterpartyOrganizationId) ?? 'another partner'}`
                              : ''}
                            {entry.expiresOn ? ` · expires ${formatDate(entry.expiresOn)}` : ''}
                          </span>
                        </td>
                        {multipleAccounts ? <td>{accountLabel(entry.accountId)}</td> : null}
                        <td className="table-num">
                          <span className="op-signed" data-sign={entry.points >= 0 ? 'up' : 'down'}>
                            {entry.points > 0 ? '+' : '−'}
                            {Math.abs(entry.points).toLocaleString('en-IN')}
                          </span>
                        </td>
                        <td className="table-num">{entry.balanceAfter.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>

              <p className="tiny muted" style={{ marginTop: 12 }}>
                The balance column is the balance of that entry&apos;s own account straight after the entry — the
                figure written in the same transaction that moved the points, not one recomputed here.
                {multipleAccounts
                  ? ' With more than one issuer the column steps between accounts, which is why each row names its own.'
                  : ''}
              </p>
            </Card>
          ) : (
            <Card>
              <Empty
                title="No entries yet"
                body="Every movement of points is written as a ledger entry with a reason. Nothing has moved on this account."
              />
            </Card>
          )}
        </section>

        </section>

        <Notice tone="info">
          <span>
            Points are worth {DEFAULT_PAISE_PER_POINT} paise each at the platform rate, which is what the estimate
            above uses. A partner may honour more or less than that, and the price you see when you spend them is
            that partner&apos;s own rate. Where your money went is on <Link href="/savings">savings</Link>.
          </span>
        </Notice>
      </Stack>
    </div>
  );
}
