/**
 * What ONEPASS has been worth.
 *
 * Every figure on this page comes from `savingsBreakdown`, which is three group-bys
 * over `savings_events` — rows written at the same moment as the booking or
 * redemption that caused them. There is no modelled saving, no "typical" figure and
 * no projection anywhere below.
 *
 * The chart fills the months between the first event and this one, because a gap
 * has to be visible as a gap: `savingsBreakdown` returns only months that have
 * rows, and a bar chart that silently closes up the empty ones draws a run of
 * savings that never happened. The filled months are drawn as empty slots by
 * `BarChart`, which is the honest picture of a month with nothing in it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  Empty,
  PageHead,
  Stack,
  Stat,
  TableScroll,
  formatMoney,
} from '@/components/ui';
import { BarChart, type BarDatum } from '@/components/consumer/bar-chart';
import { labelMonth, labelMonthShort } from '@/components/consumer/format';
import { currentActor, savingsBreakdown, type SavingsBucket } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Savings',
  description: `Every rupee ${BRAND.name} has saved you, by category and by month.`,
};

export const dynamic = 'force-dynamic';

/** The current month as `YYYY-MM`, decided in India — the same zone the group-by uses. */
function currentMonthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

/** Every month from `start` to `end` inclusive, as `YYYY-MM`. */
function monthsBetween(start: string, end: string, cap: number): string[] {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  if (!sy || !sm || !ey || !em) return [start];

  const keys: string[] = [];
  let year = sy;
  let month = sm;
  // Bounded by `cap` as well as by the end date: a first event three years back
  // would otherwise draw thirty-six columns on a phone.
  while ((year < ey || (year === ey && month <= em)) && keys.length < 600) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys.slice(-cap);
}

function shareOf(bucket: SavingsBucket, total: number): string {
  if (total <= 0) return '—';
  return `${Math.round((bucket.amountMinor / total) * 100)}%`;
}

export default async function SavingsPage() {
  const actor = await currentActor();
  const now = new Date();

  const breakdown = await savingsBreakdown(actor.userId, now);

  const byMonth = new Map(breakdown.byMonth.map((b) => [b.key, b]));
  const firstMonth = breakdown.byMonth[0]?.key;
  const months = firstMonth ? monthsBetween(firstMonth, currentMonthKey(now), 12) : [];

  const chartData: BarDatum[] = months.map((key) => {
    const bucket = byMonth.get(key);
    return {
      label: labelMonthShort(key),
      value: bucket?.amountMinor ?? 0,
      valueLabel: formatMoney(bucket?.amountMinor ?? 0),
    };
  });

  const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' }).format(now);
  const biggest = breakdown.byCategory[0];

  if (breakdown.eventCount === 0) {
    return (
      <div className="wrap stack stack-5">
        <PageHead
          eyebrow="The point of the thing"
          title="Savings"
        />
        <Card>
          <Empty
            title="Nothing saved yet"
            body="A savings event is written the moment a discounted booking is confirmed or points are redeemed. Until one is, there is nothing here to add up."
            action={
              <ButtonLink href="/deals" variant="primary">
                See live deals
              </ButtonLink>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="The point of the thing"
        title="Savings"
        lede={
          <>
            {formatMoney(breakdown.totalMinor)} across {breakdown.eventCount} event
          {breakdown.eventCount === 1 ? '' : 's'}, each one attached to the booking or redemption that caused it.
          </>
        }
      />

      <section className="stat-row" aria-label="Savings at a glance">
        <Stat label="Saved, all time" value={formatMoney(breakdown.totalMinor)} hint="Summed from real events only." />
        <Stat
          label={`Saved in ${monthLabel}`}
          value={formatMoney(breakdown.thisMonthMinor)}
          hint="Month boundaries are decided in India, not in UTC."
        />
        <Stat
          label="Largest category"
          value={biggest ? formatMoney(biggest.amountMinor) : '—'}
          hint={biggest ? `${biggest.key} · ${shareOf(biggest, breakdown.totalMinor)} of everything saved.` : undefined}
        />
      </section>

      {/* ── by month ── */}
      <section>
        <CardHead
          title="By month"
          action={<span className="small muted">{months.length} month{months.length === 1 ? '' : 's'}</span>}
        />
        <Card>
          <Stack gap={4}>
            <BarChart
              data={chartData}
              title={`Savings by month, ${formatMoney(breakdown.totalMinor)} in total`}
              axisLabel="Saved"
              formatTick={(value) => formatMoney(Math.round(value))}
            />
            <TableScroll>
              <table className="table">
                <caption className="sr-only">Savings by month</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col" className="table-num">
                      Events
                    </th>
                    <th scope="col" className="table-num">
                      Saved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((key) => {
                    const bucket = byMonth.get(key);
                    return (
                      <tr key={key}>
                        <td>{labelMonth(key)}</td>
                        <td className="table-num">{bucket?.count ?? 0}</td>
                        <td className="table-num">
                          {bucket ? formatMoney(bucket.amountMinor) : <span className="muted">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            <p className="tiny muted">
              Months with no savings are drawn as empty slots rather than skipped, so a quiet month reads as a quiet
              month.
            </p>
          </Stack>
        </Card>
      </section>

      {/* ── by category ── */}
      <section className="stack stack-3" aria-labelledby="by-category-heading">
        <div className="section-head">
          <h2 id="by-category-heading">By category</h2>
        </div>
        <Card>
          <TableScroll>
            <table className="table">
              <caption className="sr-only">Savings by category</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="table-num">
                    Events
                  </th>
                  <th scope="col" className="table-num">
                    Share
                  </th>
                  <th scope="col" className="table-num">
                    Saved
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdown.byCategory.map((bucket) => (
                  <tr key={bucket.key}>
                    <td>{bucket.key}</td>
                    <td className="table-num">{bucket.count}</td>
                    <td className="table-num">{shareOf(bucket, breakdown.totalMinor)}</td>
                    <td className="table-num">{formatMoney(bucket.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </section>

      {/* ── by source ── */}
      <section className="stack stack-3" aria-labelledby="where-it-came-from-heading">
        <div className="section-head">
          <h2 id="where-it-came-from-heading">Where it came from</h2>
        </div>
        <Card>
          <Stack gap={3}>
            <ul className="checklist">
              {breakdown.bySource.map((bucket) => (
                <li key={bucket.key} className="checkline">
                  <span className="grow row-between">
                    <span>
                      <Badge tone="accent">{bucket.key.replace(/_/g, ' ').toLowerCase()}</Badge>
                      <span className="tiny muted" style={{ display: 'block', marginTop: 4 }}>
                        {bucket.count} event{bucket.count === 1 ? '' : 's'} · {shareOf(bucket, breakdown.totalMinor)}{' '}
                        of the total
                      </span>
                    </span>
                    <strong className="mono">{formatMoney(bucket.amountMinor)}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <p className="tiny muted">
              A source is the mechanism that produced the saving — a live deal, a standing offer, a city pass, a
              points redemption, a campaign or a corporate benefit. The rows behind these totals point at the
              booking or receipt that caused them, which is what makes the figure checkable. See the money itself on{' '}
              <Link href="/receipts">receipts</Link>.
            </p>
          </Stack>
        </Card>
      </section>
    </div>
  );
}
