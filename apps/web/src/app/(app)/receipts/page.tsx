/**
 * Receipts, searchable.
 *
 * Every filter is a URL search param and the whole page is rendered on the server,
 * so a filtered view can be bookmarked, shared and reloaded, and the screen ships
 * no JavaScript to manage any of it. The form is a plain GET.
 *
 * Two things the list is careful about:
 *
 *  · The category dropdown offers only the categories that appear on this person's
 *    own receipts. A list of every category the platform knows about would mostly
 *    be options that can only return nothing.
 *  · "Returnable until" is computed from the receipt's own denormalised policy —
 *    the days copied onto the row when it was issued — not from what the merchant's
 *    policy says today. A merchant tightening its terms tomorrow cannot close a
 *    window somebody was promised.
 *
 * Paging is by cursor, carried in the URL alongside the filters, because
 * `searchReceipts` pages on the row id: a receipt issued mid-scroll cannot shift a
 * page boundary the way an offset would.
 *
 * The shape is a month ledger rather than a table. A receipt is a dated record and
 * the question asked of a list of them is nearly always "what did I spend, and
 * when" — so the months are the structure, each carries its own total, and the
 * five columns a table would need become one line and one figure.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Empty,
  Money,
  PageHead,
  Stat,
  formatDate,
  formatMoney,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { venueLine } from '@/components/consumer/format';
import {
  isWithinReturnWindow,
  receiptSummary,
  returnWindowClosesAt,
  searchReceipts,
} from '@/lib/commerce/receipts';
import { currentActor, receiptCategories, warrantyCountsForReceipts } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Receipts',
  description: `Every receipt saved to your ${BRAND.name}, searchable by merchant, date and category.`,
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

interface Query {
  q?: string;
  from?: string;
  to?: string;
  category?: string;
  cursor?: string;
}

/**
 * `YYYY-MM-DD` from a date input → the instant that day starts (or ends) in India.
 *
 * The app's clock is Asia/Kolkata; reading these boundaries in UTC would move them
 * by five and a half hours and quietly drop a late-evening receipt out of the day
 * somebody asked for. IST has no daylight saving, so the offset is a constant.
 */
function istBoundary(value: string | undefined, edge: 'start' | 'end'): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  const [, y, m, d] = match;
  const midnight = Date.UTC(Number(y), Number(m) - 1, Number(d)) - 5.5 * 3600_000;
  const at = edge === 'start' ? midnight : midnight + 86_400_000 - 1;
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Rebuilds the query string with one key changed, so paging keeps the filters. */
function href(current: Query, patch: Query): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `/receipts?${qs}` : '/receipts';
}

/** The month a receipt belongs to, in India, as a sort key and a heading. */
function monthOf(at: Date): { key: string; label: string } {
  const key = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Kolkata' }).format(
    at,
  );
  const label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(
    at,
  );
  return { key, label };
}

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const actor = await currentActor();
  const params = await searchParams;

  const q = params.q?.trim() ?? '';
  const fromRaw = params.from?.trim() ?? '';
  const toRaw = params.to?.trim() ?? '';
  const category = params.category?.trim() ?? '';
  const cursor = params.cursor?.trim() ?? '';

  const from = istBoundary(fromRaw, 'start');
  const to = istBoundary(toRaw, 'end');

  const current: Query = {
    ...(q ? { q } : {}),
    ...(fromRaw ? { from: fromRaw } : {}),
    ...(toRaw ? { to: toRaw } : {}),
    ...(category ? { category } : {}),
  };
  const filtered = Object.keys(current).length > 0;

  const now = new Date();

  const [page, categories, summary] = await Promise.all([
    searchReceipts({
      userId: actor.userId,
      limit: PAGE_SIZE,
      ...(q ? { q } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(category ? { category } : {}),
      ...(cursor ? { cursor } : {}),
    }),
    receiptCategories(actor.userId),
    receiptSummary(actor.userId, now),
  ]);

  const warrantyCounts = await warrantyCountsForReceipts(page.items.map((i) => i.receipt.id));

  // Grouped in order, so the months come out newest first without a second sort:
  // `searchReceipts` already returns the rows that way.
  const months: { key: string; label: string; totalMinor: number; rows: typeof page.items }[] = [];
  for (const row of page.items) {
    const { key, label } = monthOf(row.receipt.issuedAt);
    const last = months[months.length - 1];
    if (last && last.key === key) {
      last.rows.push(row);
      last.totalMinor += row.receipt.totalMinor;
    } else {
      months.push({ key, label, totalMinor: row.receipt.totalMinor, rows: [row] });
    }
  }

  const largest = summary.byCategory[0];

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="What you bought"
        title="Receipts"
        lede={`Every receipt a ${BRAND.name} partner has issued you, with the warranties and return windows they carry.`}
        actions={
          <>
            <ButtonLink href="/warranties" size="sm" variant="ghost">
              Warranties
            </ButtonLink>
            <ButtonLink href="/returns" size="sm" variant="ghost">
              Returns
            </ButtonLink>
          </>
        }
      />

      <section className="stat-row" aria-label="The last twelve months">
        <Stat
          label="Spent in 12 months"
          value={<Money minor={summary.totalMinor} />}
          hint={`Across ${summary.receiptCount} receipt${summary.receiptCount === 1 ? '' : 's'} since ${formatDate(summary.from)}.`}
          tone="value"
        />
        <Stat
          label="Categories seen"
          value={summary.byCategory.length}
          hint={
            largest
              ? `Largest: ${largest.category} at ${formatMoney(largest.totalMinor)}.`
              : 'Categories come from the merchant’s own line items.'
          }
        />
        <Stat
          label="Months with a purchase"
          value={summary.byMonth.length}
          hint="A month with nothing in it is absent rather than shown as a zero."
        />
      </section>

      {/* The filter rail. A GET form, so every view of this list has a URL. */}
      <Card className="stack stack-4">
        <form method="get" action="/receipts" className="stack stack-4" role="search">
          <div className="field">
            <label className="label" htmlFor="rcp-q">
              Search
            </label>
            <input
              className="input"
              id="rcp-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Merchant or item — “Croma”, “kettle”"
              autoComplete="off"
            />
            <p className="hint">Matches the merchant’s name and any line on the receipt.</p>
          </div>

          <div className="grid grid-3">
            <div className="field">
              <label className="label" htmlFor="rcp-from">
                From
              </label>
              <input className="input" id="rcp-from" name="from" type="date" defaultValue={fromRaw} />
            </div>
            <div className="field">
              <label className="label" htmlFor="rcp-to">
                To
              </label>
              <input className="input" id="rcp-to" name="to" type="date" defaultValue={toRaw} />
            </div>
            <div className="field">
              <label className="label" htmlFor="rcp-category">
                Category
              </label>
              {categories.length > 0 ? (
                <select className="select input" id="rcp-category" name="category" defaultValue={category}>
                  <option value="">Every category</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <select className="select input" id="rcp-category" name="category" defaultValue="" disabled>
                    <option value="">No categories yet</option>
                  </select>
                  <p className="hint">Merchants have not put a category on any of your lines.</p>
                </>
              )}
            </div>
          </div>

          <div className="row-wrap">
            <Button type="submit" variant="primary">
              Search
            </Button>
            {filtered ? (
              <ButtonLink href="/receipts" variant="ghost">
                Clear
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </Card>

      {months.length > 0 ? (
        <div className="stack stack-5">
          {months.map((month) => (
            <section key={month.key} className="stack stack-3" aria-labelledby={`month-${month.key}`}>
              <div className="section-head">
                <h2 id={`month-${month.key}`} className="eyebrow">
                  {month.label}
                </h2>
                <span className="small muted">
                  {month.rows.length} receipt{month.rows.length === 1 ? '' : 's'} ·{' '}
                  <Money minor={month.totalMinor} />
                </span>
              </div>

              <Card>
                <ul className="ledger">
                  {month.rows.map(({ receipt, organization, venue }) => {
                    const warranties = warrantyCounts.get(receipt.id) ?? 0;
                    const returnable = isWithinReturnWindow(receipt, now);
                    const closesAt = returnWindowClosesAt(receipt);

                    return (
                      <li key={receipt.id}>
                        <span className="ledger-main">
                          <Link className="ledger-title" href={`/receipts/${receipt.publicRef}`}>
                            {organization?.name ?? 'Unnamed merchant'}
                          </Link>
                          <span className="ledger-meta">
                            {formatDate(receipt.issuedAt)}
                            {venue ? ` · ${venueLine(venue)}` : ''} ·{' '}
                            <span className="mono">{receipt.publicRef}</span>
                          </span>
                          <span className="row-wrap" style={{ marginTop: 4 }}>
                            {warranties > 0 ? (
                              <Badge tone="info">
                                <Glyph name="shield" size={13} />
                                {warranties} warrant{warranties === 1 ? 'y' : 'ies'}
                              </Badge>
                            ) : null}
                            {returnable ? (
                              <Badge tone="ok">Returnable until {formatDate(closesAt)}</Badge>
                            ) : receipt.returnWindowDays > 0 ? (
                              <Badge tone="neutral">Window closed {formatDate(closesAt)}</Badge>
                            ) : (
                              <Badge tone="neutral">No returns</Badge>
                            )}
                          </span>
                        </span>
                        <span className="ledger-figure">
                          <Money minor={receipt.totalMinor} currency={receipt.currency} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}

          {page.nextCursor || cursor ? (
            <div className="row-wrap">
              {cursor ? <ButtonLink href={href(current, {})}>← Back to the newest</ButtonLink> : null}
              {page.nextCursor ? (
                <ButtonLink href={href(current, { cursor: page.nextCursor })} variant="primary">
                  Older receipts →
                </ButtonLink>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <Card>
          <Empty
            title={filtered || cursor ? 'Nothing matches those filters' : 'No receipts yet'}
            body={
              filtered || cursor
                ? 'Try a shorter search, a wider date range, or clear the filters.'
                : 'A receipt is saved here whenever a partner issues one against your pass — in store, online or in the app.'
            }
            action={
              filtered || cursor ? (
                <ButtonLink href="/receipts">Clear filters</ButtonLink>
              ) : (
                <ButtonLink href="/explore" variant="primary">
                  Find a partner
                </ButtonLink>
              )
            }
          />
        </Card>
      )}
    </div>
  );
}
