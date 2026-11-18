/**
 * Loyalty — four numbers, and what each of them costs you.
 *
 * A rewards page that lists "5 points per ₹100" and stops is a page nobody can
 * price. Every rate here is therefore shown twice: as it is stored, and as what
 * it does to a real sale. The arithmetic is the platform's own — `pointsForSpend`
 * and the redemption quote — restated in rupees rather than reimplemented, so the
 * worked example below cannot drift from what the ledger actually writes.
 *
 * The cross-brand switch is the commercially interesting one. Accepting points
 * earned elsewhere discounts your sale today; the platform settles with the
 * issuing partner at *their* settlement rate, which is why nobody ends up giving
 * away someone else's margin.
 */
import type { Metadata } from 'next';
import { Badge, Card, CardHead, Notice, Stat, TableScroll, formatMoney } from '@/components/ui';
import { FeatureNote } from '@/components/system';
import { requirePartner } from '@/components/partner/guard';
import { PageHeader } from '@/components/partner/shell';
import {
  DEFAULT_EARN_PER_HUNDRED,
  DEFAULT_PAISE_PER_POINT,
  pointsForSpend,
  programFor,
} from '@/lib/commerce/rewards';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Loyalty' };
export const dynamic = 'force-dynamic';

/** Sale sizes a merchant recognises, in paise. */
const EXAMPLE_SALES_MINOR = [50_000, 100_000, 250_000, 500_000];

export default async function LoyaltyPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.org:read', orgId, `/business/${orgId}/loyalty`);

  // The guard's id. `programFor` falls back to the platform defaults when this
  // organization has never configured a programme of its own.
  const program = await programFor(ctx.organizationId);
  const configured = 'organizationId' in program;
  const name = 'name' in program ? program.name : 'Platform default programme';

  /** What a ₹100 sale gives away, in paise, valued at this partner's own redeem rate. */
  const costPerHundredMinor = program.earnPointsPerHundred * program.redeemPaisePerPoint;
  const costPct = (costPerHundredMinor / 10_000) * 100;

  return (
    <div className="stack stack-5">
      <PageHeader
        eyebrow="Relationships"
        title="Loyalty"
        lede="The reward rules this organization trades under, and what each of them costs or earns. Points are a ledger, not a balance — every entry carries a reason, a signed amount and the balance it produced."
      />

      {!configured ? (
        <Notice tone="info">
          <span>
            This organization has not configured a programme, so the platform defaults apply:{' '}
            {DEFAULT_EARN_PER_HUNDRED} points per ₹100 earned, {DEFAULT_PAISE_PER_POINT} paise per
            point redeemed. Nothing is broken — these are the rules in force until a programme is
            written.
          </span>
        </Notice>
      ) : null}

      {!program.isActive ? (
        <Notice tone="warn">
          <span>
            This programme is inactive. Purchases at this organization earn no points while it stays
            that way; points already earned are untouched and remain spendable.
          </span>
        </Notice>
      ) : null}

      <div className="grid grid-4">
        <Stat
          label="Earn rate"
          value={`${program.earnPointsPerHundred} pts`}
          hint="Granted per ₹100 a customer spends here"
        />
        <Stat
          label="Redeem rate"
          value={`${program.redeemPaisePerPoint}p`}
          hint="What one point takes off a bill here"
        />
        <Stat
          label="Settlement rate"
          value={`${program.settlementPaisePerPoint}p`}
          hint="What you are paid when your points are spent elsewhere"
        />
        <Stat
          label="Cost of earning"
          value={`${costPct.toFixed(2)}%`}
          hint={`${formatMoney(costPerHundredMinor)} of every ₹100 sold, at your own redeem rate`}
          tone={costPct > 2 ? 'warn' : undefined}
        />
      </div>

      <Card>
        <CardHead
          title={name}
          // `row-wrap`, not `row`: two badges beside a heading have nowhere to
          // go on a 320px screen, and a `row` pushed them off the side.
          action={
            <span className="row-wrap">
              {configured ? (
                <Badge tone="ok" dot>
                  configured
                </Badge>
              ) : (
                <Badge tone="neutral">platform default</Badge>
              )}
              {program.isActive ? <Badge tone="ok">active</Badge> : <Badge tone="warn">inactive</Badge>}
            </span>
          }
        />

        <dl className="dl">
          <div>
            <dt>
              Earn rate
              <span className="tiny muted stacked">
                What a sale gives away
              </span>
            </dt>
            <dd>
              <strong className="mono">{program.earnPointsPerHundred} points per ₹100</strong>
              <span className="tiny muted stacked normal">
                Rounded down, so a ₹99 sale earns nothing rather than a fraction. Costs you{' '}
                {formatMoney(costPerHundredMinor)} per ₹100 — {costPct.toFixed(2)}% of the sale —
                valued at what those points buy back here.
              </span>
            </dd>
          </div>

          <div>
            <dt>
              Redeem rate
              <span className="tiny muted stacked">
                What a point is worth at your till
              </span>
            </dt>
            <dd>
              <strong className="mono">{program.redeemPaisePerPoint} paise per point</strong>
              <span className="tiny muted stacked normal">
                100 points comes off a bill as {formatMoney(100 * program.redeemPaisePerPoint)}. This
                is the discount you fund yourself when a customer spends points they earned with you.
              </span>
            </dd>
          </div>

          <div>
            <dt>
              External points
              <span className="tiny muted stacked">
                Whether you honour other partners&rsquo; points
              </span>
            </dt>
            <dd>
              {program.acceptsExternalPoints ? (
                <>
                  <Badge tone="ok" dot>
                    accepted
                  </Badge>
                  <span className="tiny muted stacked normal">
                    Someone who earned points at another {BRAND.name} partner can spend them here. You
                    discount the sale at your redeem rate and the platform settles with the issuer at{' '}
                    <em>their</em> settlement rate — so the discount is funded by whoever issued the
                    points, not by you. This is what brings you customers who have never bought from
                    you before.
                  </span>
                </>
              ) : (
                <>
                  <Badge tone="neutral">not accepted</Badge>
                  <span className="tiny muted stacked normal">
                    A redemption of points earned at another partner is refused here. Only points
                    earned with you can be spent with you. Turning this on is a commercial decision,
                    not a technical one: it costs nothing directly and brings in people whose points
                    someone else funded.
                  </span>
                </>
              )}
            </dd>
          </div>

          <div>
            <dt>
              Settlement rate
              <span className="tiny muted stacked">
                What you earn when your points travel
              </span>
            </dt>
            <dd>
              <strong className="mono">{program.settlementPaisePerPoint} paise per point</strong>
              <span className="tiny muted stacked normal">
                When a customer spends points you issued at another partner, the platform pays that
                partner and charges you this rate — {formatMoney(100 * program.settlementPaisePerPoint)}{' '}
                per 100 points. It sits below your own redeem rate of{' '}
                {program.redeemPaisePerPoint}p, so honouring a point yourself is
                {program.settlementPaisePerPoint <= program.redeemPaisePerPoint
                  ? ' the more expensive of the two — a point spent elsewhere costs you less than one spent here.'
                  : ' the cheaper of the two.'}
              </span>
            </dd>
          </div>

          <div>
            <dt>Minimum redemption</dt>
            <dd>
              <strong className="mono">{program.minRedeemPoints} points</strong>
              <span className="tiny muted stacked normal">
                Worth {formatMoney(program.minRedeemPoints * program.redeemPaisePerPoint)} here. Below
                this a redemption is refused, which keeps the ledger free of one-rupee entries.
              </span>
            </dd>
          </div>

          <div>
            <dt>Expiry</dt>
            <dd>
              {program.pointsExpireMonths ? (
                <>
                  <strong className="mono">{program.pointsExpireMonths} months</strong>
                  <span className="tiny muted stacked normal">
                    Points carry an expiry date set when they are earned. An expiry already granted
                    is not shortened by a later change.
                  </span>
                </>
              ) : (
                <>
                  <Badge tone="neutral">never</Badge>
                  <span className="tiny muted stacked normal">
                    Points you issue stay on the ledger until they are spent. Simpler for the
                    customer, and an open liability on your side — which is the honest way to
                    describe it.
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHead
          title="What that means for a real sale"
          action={<span className="small muted">Computed with the platform&rsquo;s own arithmetic</span>}
        />
        <TableScroll>
          <table className="table">
            <thead>
              <tr>
                <th scope="col" className="table-num">Sale</th>
                <th scope="col" className="table-num">Points earned</th>
                <th scope="col" className="table-num">Worth here</th>
                <th scope="col" className="table-num">Cost to you</th>
                <th scope="col" className="table-num">If spent elsewhere</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLE_SALES_MINOR.map((sale) => {
                const points = pointsForSpend(sale, program.earnPointsPerHundred);
                const worth = points * program.redeemPaisePerPoint;
                const settlement = points * program.settlementPaisePerPoint;
                return (
                  <tr key={sale}>
                    <td className="table-num">{formatMoney(sale)}</td>
                    <td className="table-num">{points}</td>
                    <td className="table-num">{formatMoney(worth)}</td>
                    <td className="table-num">
                      {formatMoney(worth)}
                      <span className="tiny muted"> ({((worth / sale) * 100).toFixed(2)}%)</span>
                    </td>
                    <td className="table-num">{formatMoney(settlement)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
        <p className="tiny muted measure-wide">
          &ldquo;Cost to you&rdquo; is what the points from that sale take off a future bill{' '}
          <em>at your till</em>. &ldquo;If spent elsewhere&rdquo; is what the platform charges you to
          settle with the partner who honoured them instead — the same points, funded once. Points
          are only ever a cost when they are actually spent; unspent points cost nothing and are
          shown here as a liability, not as revenue.
        </p>
      </Card>

      {/* This said changes "go through the partner API rather than a form". No
          such endpoint exists, which made the one screen that explains your
          commercial terms the one screen that misdirects you. The registry is
          now the single place that states it, so the sentence cannot drift
          from the sentence the rest of the product tells. */}
      <Notice tone="warn">
        <span>
          These settings are read-only, and there is no way to change them yourself yet — not in
          this console and not through the API. Ask platform operations and they will make the
          change for you. A rate change never rewrites points already on the ledger.
        </span>
      </Notice>
      <FeatureNote featureKey="loyalty-config" />
    </div>
  );
}
