/**
 * Demand — a trailing mean, labelled as one.
 *
 * `forecastVenue` averages what the same weekday and hour band actually sold over
 * the last eight weeks. That is the whole method, and the page says so: there is
 * no model, and a number with nothing behind it is worse than no number.
 *
 * Three rules are enforced here rather than left to the reader:
 *   · Where fewer than MIN_WINDOWS past windows matched, or confidence is zero,
 *     the note is shown *instead of* a figure and no bar is drawn. A bar at 0%
 *     reads as "we expect nobody", which is not what "we have no history" means.
 *   · Every estimated figure carries <EstimateTag/>. Capacity does not — it is
 *     published, not estimated.
 *   · A discount is offered only where the service suggested one, which it does
 *     only above MIN_CONFIDENCE_TO_SUGGEST.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardHead,
  Empty,
  EstimateTag,
  Meter,
  Notice,
  Stat,
  formatDateTime,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { MethodLine } from '@/components/partner/evidence';
import { PageHeader, Summary } from '@/components/partner/shell';
import { toIstInputValue } from '@/components/partner/time';
import {
  MIN_CONFIDENCE_TO_SUGGEST,
  MIN_WINDOWS,
  listForecasts,
  utilisationSummary,
} from '@/lib/insights/demand';

export const metadata: Metadata = { title: 'Demand' };
export const dynamic = 'force-dynamic';

const HORIZON_DAYS = 14;
const MAX_ROWS = 60;

/** The pre-filled deal, built from what the estimate actually suggested. */
function dealHref(
  base: string,
  row: { slotId: string; label: string; startsAt: Date; suggestedDiscountBp: number | null; suggestedReleaseAt: Date | null },
): string {
  const percent = Math.round((row.suggestedDiscountBp ?? 0) / 100);
  const params = new URLSearchParams({
    slotId: row.slotId,
    discountKind: 'PERCENT',
    discountValue: String(percent),
    title: `${row.label} — ${percent}% off`,
    startsAt: toIstInputValue(row.suggestedReleaseAt ?? new Date()),
    endsAt: toIstInputValue(row.startsAt),
  });
  return `${base}/deals/new?${params.toString()}`;
}

export default async function DemandPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.analytics:read', orgId, `/business/${orgId}/demand`);
  const organizationId = ctx.organizationId;
  const base = `/business/${organizationId}`;
  const canPublish = ctx.permissions.has('partner.org:write');

  // Both read from the guard's organization id. `listForecasts` resolves this
  // organization's active venues first, so a slot at someone else's venue is not
  // reachable from here whatever id was in the path.
  const [rows, observed] = await Promise.all([
    listForecasts(organizationId, HORIZON_DAYS),
    utilisationSummary(organizationId, 28),
  ]);

  const shown = rows.slice(0, MAX_ROWS);
  const estimable = shown.filter((row) => row.sampleSize >= MIN_WINDOWS && row.confidence > 0);
  const suggestions = shown.filter((row) => row.suggestedDiscountBp !== null);

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Analysis"
        title="Demand"
        lede={
          <>
            Upcoming slots over the next {HORIZON_DAYS} days, with what the same weekday and hour
            band sold in the eight weeks behind them. This is a trailing mean over your own rows —
            not a model, and not a promise.
          </>
        }
      />

      <div className="grid grid-4">
        <Stat
          label="Utilisation, last 28 days"
          value={observed.capacity > 0 ? `${Math.round(observed.utilisationBp / 100)}%` : '—'}
          hint={
            observed.capacity > 0
              ? `${observed.sold} sold of ${observed.capacity} across ${observed.slots} slots — observed, not estimated`
              : 'No slots ran in the last 28 days'
          }
        />
        <Stat
          label="Capacity that expired unsold"
          value={observed.unsold}
          hint="Seats, covers or bays that ran out of time in the last 28 days"
          tone={observed.unsold > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Slots ahead"
          value={shown.length}
          hint={`Published across the next ${HORIZON_DAYS} days`}
        />
        <Stat
          label="Estimable"
          value={`${estimable.length}/${shown.length}`}
          hint={`Slots with at least ${MIN_WINDOWS} matching past windows`}
        />
      </div>

      <Card>
        <div className="stack stack-3">
          <CardHead
            title="How the estimate is made"
            action={<EstimateTag>Estimate</EstimateTag>}
          />
          <p className="small muted measure-wide">
            For each upcoming slot we take every past slot at the same venue with the{' '}
            <strong>same weekday and the same hour</strong>, and average what they sold. Confidence
            is derived, not asserted: <span className="mono tiny">confidence = 100 × min(1, n/8) × max(0, 1 − cv)</span>{' '}
            where <span className="mono tiny">n</span> is the number of matching windows and{' '}
            <span className="mono tiny">cv</span> is their spread (standard deviation ÷ mean). Eight
            wildly varying weeks therefore score no better than two consistent ones. Below{' '}
            {MIN_WINDOWS} matching windows there is no confidence at all and the slot shows a note
            instead of a number; below {MIN_CONFIDENCE_TO_SUGGEST}% confidence no discount is
            suggested.
          </p>
          <Summary
            items={[
              { label: 'Method', value: <span className="tiny">trailing-weekday-hour-mean</span> },
              { label: 'History', value: '56 days' },
              { label: 'Horizon', value: `${HORIZON_DAYS} days` },
              { label: 'Suggestions', value: suggestions.length },
            ]}
          />
        </div>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <Empty
            title="No upcoming capacity"
            body={`Nothing is published at this organization's active venues in the next ${HORIZON_DAYS} days. Slots appear here as soon as capacity exists to forecast.`}
          />
        </Card>
      ) : (
        <div className="grid grid-2">
          {shown.map((row) => {
            const thin = row.sampleSize < MIN_WINDOWS || row.confidence === 0;
            const utilisationPct = Math.round(row.expectedUtilisationBp / 100);
            const weak = !thin && row.confidence < MIN_CONFIDENCE_TO_SUGGEST;

            return (
              <Card key={row.slotId} as="article">
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <p className="eyebrow">{row.venueName}</p>
                    <h2 className="h3" style={{ marginTop: 4 }}>
                      {row.label}
                    </h2>
                    <p className="small muted" style={{ marginTop: 4 }}>
                      {formatDateTime(row.startsAt)} → {formatDateTime(row.endsAt)}
                    </p>
                  </div>
                  {thin ? (
                    <Badge tone="neutral">no history</Badge>
                  ) : weak ? (
                    <Badge tone="warn">weak</Badge>
                  ) : (
                    <Badge tone="ok" dot>
                      {row.confidence}% confidence
                    </Badge>
                  )}
                </div>

                <dl className="dl" style={{ marginTop: 16 }}>
                  <div>
                    <dt>Published capacity</dt>
                    <dd className="mono">{row.capacity}</dd>
                  </div>
                  <div>
                    <dt>Expected demand</dt>
                    <dd>
                      {thin ? (
                        <span className="muted">not estimated</span>
                      ) : (
                        <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                          <span className="mono">{row.expectedDemand}</span>
                          <EstimateTag />
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Expected utilisation</dt>
                    <dd>
                      {thin ? (
                        <span className="muted">not estimated</span>
                      ) : (
                        <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                          <span className="mono">{utilisationPct}%</span>
                          <EstimateTag />
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>
                      {thin ? (
                        <span className="muted">none claimed</span>
                      ) : (
                        <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                          <span className="mono">{row.confidence}%</span>
                          <EstimateTag />
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Matching past windows</dt>
                    <dd className="mono">{row.sampleSize}</dd>
                  </div>
                </dl>

                {/* No bar where there is no estimate: an empty meter reads as "we
                    expect nobody", which is not what "no history" means. */}
                {thin ? null : (
                  <div className="stack stack-2" style={{ marginTop: 14 }}>
                    <Meter
                      value={row.expectedDemand}
                      max={row.capacity}
                      label={`${row.expectedDemand} of ${row.capacity} expected to sell`}
                      tone={utilisationPct < 60 ? 'warn' : 'ok'}
                    />
                    <p className="tiny muted">
                      {row.expectedDemand} of {row.capacity} expected to sell ·{' '}
                      {Math.max(0, row.capacity - row.expectedDemand)} expected to go unsold
                    </p>
                  </div>
                )}

                <div className="card-flat" style={{ marginTop: 14 }}>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    {row.note}
                  </p>
                  <div style={{ marginTop: 8 }}>
                    <MethodLine method={row.method} sampleSize={row.sampleSize} sampleNoun="past windows" />
                  </div>
                </div>

                {row.suggestedDiscountBp !== null ? (
                  <div className="stack stack-3" style={{ marginTop: 14 }}>
                    <hr className="divider" />
                    <div className="row-between">
                      <div>
                        <p className="eyebrow">Suggested markdown</p>
                        <p className="num" style={{ fontSize: 22, marginTop: 2 }}>
                          {Math.round(row.suggestedDiscountBp / 100)}%
                        </p>
                      </div>
                      <EstimateTag>Suggestion</EstimateTag>
                    </div>
                    <p className="tiny muted">
                      Release{' '}
                      {row.suggestedReleaseAt ? (
                        <strong>{formatDateTime(row.suggestedReleaseAt)}</strong>
                      ) : (
                        'as soon as you can'
                      )}{' '}
                      — proportional to the shortfall, so the emptier the slot looks the earlier it
                      is worth putting in front of people. Capped at 40%: past that a markdown stops
                      filling spare capacity and starts teaching full-price customers to wait.
                    </p>
                    {canPublish ? (
                      <Link className="btn btn-sm btn-primary" href={dealHref(base, row)}>
                        Create this deal
                      </Link>
                    ) : (
                      <p className="tiny muted">
                        Publishing a deal needs the organization write permission, which your role
                        does not hold.
                      </p>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Notice tone="info">
        <span>
          Every figure above marked <EstimateTag /> is computed from this organization&rsquo;s past
          slot counters. Utilisation for the last 28 days, published capacity and the sample counts
          are observed values read straight from the rows.
        </span>
      </Notice>
    </div>
  );
}
