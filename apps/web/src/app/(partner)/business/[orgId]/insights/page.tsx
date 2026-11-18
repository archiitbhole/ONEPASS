/**
 * Insights — arithmetic over this organization's own rows, with the working shown.
 *
 * WHAT THIS IS NOT: there is no model here, nothing is inferred, and nothing is
 * predicted. Each finding is produced by a named detector in
 * src/lib/insights/merchant.ts — a pure function over rows this organization
 * owns — and every one of them stores `method`, `sampleSize` and an `evidence`
 * object holding the figures it was derived from. All three are on the page
 * because a claim a merchant cannot check is a claim they should not act on.
 *
 * The sample threshold is the honest part. `MIN_CONFIDENT_SAMPLE` records is the
 * line below which the service itself downgrades a finding, strips its
 * recommendation and says the sample is thin; this page marks such a row as a
 * hint so it cannot be mistaken for a conclusion at a glance.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardHead,
  Empty,
  Notice,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { EvidenceTable, MethodLine } from '@/components/partner/evidence';
import { PageHeader, Summary } from '@/components/partner/shell';
import { MIN_CONFIDENT_SAMPLE, listInsights, type Severity } from '@/lib/insights/merchant';
import { dismissInsightAction, markInsightActed, recomputeInsights } from './actions';

export const metadata: Metadata = { title: 'Insights' };
export const dynamic = 'force-dynamic';

const SEVERITY_TONE: Record<Severity, 'bad' | 'accent' | 'warn'> = {
  RISK: 'bad',
  OPPORTUNITY: 'accent',
  WATCH: 'warn',
};

const SEVERITY_MEANING: Record<Severity, string> = {
  RISK: 'A number moving the wrong way.',
  OPPORTUNITY: 'Capacity or custom being left on the table.',
  WATCH: 'Worth knowing; not yet worth acting on.',
};

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ?? null;
}

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orgId } = await params;
  const query = await searchParams;
  const ctx = await requirePartner('partner.analytics:read', orgId, `/business/${orgId}/insights`);

  // The guard's id, never params.orgId.
  const stored = await listInsights(ctx.organizationId, 20);
  const base = `/business/${ctx.organizationId}`;

  /**
   * One row per detector — the most recently computed.
   *
   * `computeInsights` upserts on (organization, method, windowStart), and its
   * window start is "now minus 56 days" to the millisecond, so a second run a
   * minute later writes a new row rather than updating the old one. That is the
   * service's business; what this page must not do is show the same finding
   * twice because someone pressed Recompute. Older computations are collapsed
   * rather than deleted, and the count of what was collapsed is stated below.
   */
  const newest = new Map<string, (typeof stored)[number]>();
  for (const row of stored) {
    const seen = newest.get(row.insight.method);
    if (!seen || seen.insight.computedAt < row.insight.computedAt) {
      newest.set(row.insight.method, row);
    }
  }
  // Filtering preserves listInsights' own ordering: RISK, then OPPORTUNITY, then WATCH.
  const rows = stored.filter((row) => newest.get(row.insight.method) === row);
  const superseded = stored.length - rows.length;

  const error = first(query.error);
  const computed = first(query.computed);
  const acted = first(query.acted);
  const dismissed = first(query.dismissed);

  const confident = rows.filter((row) => row.insight.sampleSize >= MIN_CONFIDENT_SAMPLE);
  const hints = rows.filter((row) => row.insight.sampleSize < MIN_CONFIDENT_SAMPLE);
  const risks = rows.filter((row) => row.insight.severity === 'RISK');
  const opportunities = rows.filter((row) => row.insight.severity === 'OPPORTUNITY');

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Analysis"
        title="Insights"
        lede={
          <>
            Computed statistics over this organization&rsquo;s own rows — bookings, captured
            payments and slot counters. Each finding names the calculation that produced it, how
            many records it ran over, and the figures it was derived from.
          </>
        }
        actions={
          <form action={recomputeInsights.bind(null, ctx.organizationId)}>
            <Button type="submit" variant="primary">
              Recompute
            </Button>
          </form>
        }
      />

      {error ? (
        <Notice tone="bad">
          <span role="alert">{error}</span>
        </Notice>
      ) : null}
      {computed !== null ? (
        <Notice tone={Number(computed) > 0 ? 'ok' : 'info'}>
          <span>
            {Number(computed) === 0
              ? 'The detectors ran and found nothing that met their thresholds. That is a result, not a failure — a flat week produces no finding.'
              : `The detectors ran and produced ${computed} ${Number(computed) === 1 ? 'finding' : 'findings'}. Only the newest run of each detector is listed below.`}
          </span>
        </Notice>
      ) : null}
      {acted ? (
        <Notice tone="ok">
          <span>Marked as acted on. It stays on the record with the date you dealt with it.</span>
        </Notice>
      ) : null}
      {dismissed ? (
        <Notice tone="info">
          <span>Dismissed. The row is hidden, not deleted — the calculation behind it is still on file.</span>
        </Notice>
      ) : null}

      <Card>
        <div className="stack stack-4">
          <Summary
            items={[
              { label: 'Findings', value: rows.length },
              { label: 'Risks', value: risks.length },
              { label: 'Opportunities', value: opportunities.length },
              { label: 'Confident', value: confident.length },
              { label: 'Hints', value: hints.length },
            ]}
          />
          {superseded > 0 ? (
            <p className="tiny muted">
              {superseded} earlier {superseded === 1 ? 'computation is' : 'computations are'} held
              on file for these same detectors and not shown — only the most recent run of each is
              listed, so a second press of Recompute does not double the page.
            </p>
          ) : null}
          <p className="tiny muted measure-wide">
            <strong>How to read this page.</strong> Nothing here is a prediction and nothing is
            generated: each row is the output of a named function over rows you can query yourself.
            A finding computed from fewer than {MIN_CONFIDENT_SAMPLE} records is marked{' '}
            <Badge tone="warn">hint</Badge> and carries no recommendation, because a recommendation
            off a thin sample is a guess with your money attached.
          </p>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <Empty
            title="No findings"
            body="Either the detectors have not run for this organization yet, or nothing crossed their thresholds. Recompute to run them now over the last 56 days."
          />
        </Card>
      ) : (
        <div className="stack stack-4">
          {rows.map(({ insight, venue }) => {
            const thin = insight.sampleSize < MIN_CONFIDENT_SAMPLE;
            const severity = insight.severity as Severity;

            return (
              <Card key={insight.id} as="article">
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <p className="row-wrap" style={{ gap: 8, margin: 0 }}>
                      <Badge tone={SEVERITY_TONE[severity]} dot>
                        {severity.toLowerCase()}
                      </Badge>
                      {thin ? <Badge tone="warn">hint · thin sample</Badge> : null}
                      {insight.actedAt ? <Badge tone="ok">acted {formatRelative(insight.actedAt)}</Badge> : null}
                      {venue ? <Badge tone="neutral">{venue.name}</Badge> : null}
                    </p>
                    <h2 className="h3" style={{ marginTop: 10 }}>
                      {insight.headline}
                    </h2>
                    <p className="small measure">
                      {insight.detail}
                    </p>
                  </div>
                  <span className="tiny muted nowrap">
                    {formatRelative(insight.computedAt)}
                  </span>
                </div>

                {insight.recommendation ? (
                  <div className="card-flat" style={{ marginTop: 16 }}>
                    <p className="eyebrow">What to do about it</p>
                    <p className="small measure">
                      {insight.recommendation}
                    </p>
                  </div>
                ) : (
                  <Notice tone="warn">
                    <span>
                      No recommendation is offered. {insight.sampleSize}{' '}
                      {insight.sampleSize === 1 ? 'record' : 'records'} is below the{' '}
                      {MIN_CONFIDENT_SAMPLE} the service treats as confident, so this is reported as
                      a hint and nothing is advised on it.
                    </span>
                  </Notice>
                )}

                <hr className="divider" style={{ marginBlock: 16 }} />

                <div className="stack stack-3">
                  <div className="row-between">
                    <p className="eyebrow">The figures it was derived from</p>
                    <span className="tiny muted">
                      window {formatDateTime(insight.windowStart)} → {formatDateTime(insight.windowEnd)}
                    </span>
                  </div>

                  <MethodLine
                    method={insight.method}
                    sampleSize={insight.sampleSize}
                    extra={thin ? `below the confident threshold of ${MIN_CONFIDENT_SAMPLE}` : undefined}
                  />

                  <EvidenceTable evidence={insight.evidence} />
                </div>

                <div className="row-wrap" style={{ marginTop: 16, gap: 8 }}>
                  {insight.actedAt ? null : (
                    <form action={markInsightActed.bind(null, ctx.organizationId)}>
                      <input type="hidden" name="insightId" value={insight.id} />
                      <Button type="submit" size="sm">
                        Mark as acted on
                      </Button>
                    </form>
                  )}
                  <form action={dismissInsightAction.bind(null, ctx.organizationId)}>
                    <input type="hidden" name="insightId" value={insight.id} />
                    <Button type="submit" size="sm" variant="ghost">
                      Dismiss
                    </Button>
                  </form>
                  {insight.method === 'slot-utilisation-gap' || insight.method === 'weekday-revenue-variance' ? (
                    <Link className="btn btn-sm" href={`${base}/deals/new`}>
                      Create a deal
                    </Link>
                  ) : null}
                  {insight.method === 'slot-utilisation-gap' ? (
                    <Link className="btn btn-sm" href={`${base}/demand`}>
                      See the slots
                    </Link>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHead title="What each severity means" />
        <dl className="dl">
          {(Object.keys(SEVERITY_MEANING) as Severity[]).map((severity) => (
            <div key={severity}>
              <dt>
                <Badge tone={SEVERITY_TONE[severity]} dot>
                  {severity.toLowerCase()}
                </Badge>
              </dt>
              <dd>{SEVERITY_MEANING[severity]}</dd>
            </div>
          ))}
          <div>
            <dt>
              <Badge tone="warn">hint</Badge>
            </dt>
            <dd>
              Fewer than {MIN_CONFIDENT_SAMPLE} records behind it. Reported so you can see it,
              downgraded so you do not act on it.
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
