/**
 * The City Pass.
 *
 * One pass, one city, a list of what it lets you through — and, if you hold one,
 * how much of each entitlement you have left.
 *
 * The arithmetic is deliberately thin. `remaining` is `allowance − uses`, counted
 * from `city_pass_uses` by `cityPassOverview`; there is no cached remaining
 * column and this page does not invent one, because a number that can drift away
 * from the rows it claims to total is worse than no number.
 *
 * Two honesty rules the layout is built around:
 *
 *  · Someone who does not hold the pass sees what it costs and what it covers,
 *    and is told plainly that they do not hold it. They are not shown a row of
 *    zeroed counters that look like a start they have made.
 *  · The face value is the sum of the list prices of what is included. It is what
 *    the pass is worth if every entitlement is used, which almost nobody does —
 *    so it is labelled as that rather than presented as a saving.
 *
 * Buying is not wired here. There is no checkout for a city pass in this build,
 * and a button that did nothing would be the dishonest option; the screen says so
 * instead.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  Empty,
  Notice,
  PageHead,
  Stat,
  formatDate,
  formatMoney,
} from '@/components/ui';
import { labelKind } from '@/components/consumer/format';
import { currentActor, cityPassOverview } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'City Pass',
  description: 'One pass across a city, and what it covers.',
};

export const dynamic = 'force-dynamic';

export default async function CityPassPage() {
  const actor = await currentActor();
  const overview = await cityPassOverview(actor.userId);

  if (!overview) {
    return (
      <div className="wrap">
        <Card>
          <Empty
            title="No city pass is running"
            body={`${BRAND.name} publishes a city pass per city, and none is live right now. Nothing is hidden here — the table is empty.`}
            action={
              <ButtonLink href="/explore" size="sm">
                Explore the city instead
              </ButtonLink>
            }
          />
        </Card>
      </div>
    );
  }

  const { pass, city, entitlements, holding, usedByEntitlement } = overview;

  const totalAllowance = entitlements.reduce((sum, e) => sum + e.allowance, 0);
  const totalUsed = entitlements.reduce((sum, e) => sum + (usedByEntitlement.get(e.id) ?? 0), 0);
  const heldValueUsed = entitlements.reduce(
    (sum, e) => sum + e.listValueMinor * (usedByEntitlement.get(e.id) ?? 0),
    0,
  );

  const expired = holding?.expiresAt ? holding.expiresAt.getTime() <= Date.now() : false;

  // `.wrap` is what every other consumer page is inside, and this one was not —
  // so the city pass rendered edge to edge while its neighbours had gutters,
  // which reads as a broken page rather than a different one. The layout gives
  // vertical rhythm only; the container is each page's own.
  return (
    <div className="wrap stack stack-5">
      <PageHead
        eyebrow={city ? `${city.name}${city.state ? `, ${city.state}` : ''}` : 'City pass'}
        title={pass.name}
        lede={pass.tagline ?? undefined}
        actions={
          holding ? (
            <Badge tone={expired ? 'warn' : 'ok'} dot>
              {expired ? 'expired' : holding.activatedAt ? 'active' : 'not yet activated'}
            </Badge>
          ) : (
            <Badge tone="neutral">not held</Badge>
          )
        }
      />

      <Card>
        <div className="stack stack-4">
          {pass.description ? <p className="muted">{pass.description}</p> : null}

          <div className="stat-row">
            <Stat label="Price" value={formatMoney(pass.priceMinor, pass.currency)} />
            <Stat
              label="If everything is used"
              value={formatMoney(pass.faceValueMinor, pass.currency)}
              hint="Sum of the list prices of what is included — not a saving anyone is promised."
            />
            <Stat label="Valid for" value={`${pass.validDays} days`} />
            <Stat label="Places" value={entitlements.length} />
          </div>

          <p className="tiny muted">
            {totalAllowance} admissions across {entitlements.length}{' '}
            {entitlements.length === 1 ? 'venue' : 'venues'}
          </p>
        </div>
      </Card>

      {holding ? (
        <Card>
          <div className="stack stack-4">
            <CardHead title="Your pass" />
            <div className="stat-row">
              <Stat label="Reference" value={<span className="mono">{holding.publicRef}</span>} />
              <Stat
                label="Used so far"
                value={`${totalUsed} of ${totalAllowance}`}
                hint={
                  heldValueUsed > 0
                    ? `${formatMoney(heldValueUsed, pass.currency)} of list value taken`
                    : 'Nothing used yet.'
                }
              />
              <Stat
                label={holding.activatedAt ? 'Activated' : 'Bought'}
                value={formatDate(holding.activatedAt ?? holding.createdAt)}
              />
              <Stat
                label="Runs out"
                value={holding.expiresAt ? formatDate(holding.expiresAt) : 'On first use'}
                hint={
                  holding.expiresAt
                    ? undefined
                    : `The ${pass.validDays}-day window starts when the pass is first presented.`
                }
              />
            </div>
            <p className="tiny muted">
              Present your {BRAND.name} at any venue below. The pass is the same code as everywhere else —
              there is no second QR to keep track of.
            </p>
          </div>
        </Card>
      ) : (
        <Notice tone="info">
          You do not hold this pass. What follows is what it covers, at the venues&rsquo; own list
          prices. There is no checkout for a city pass in this build, so nothing here will sell you
          one — it is listed rather than offered.
        </Notice>
      )}

      <Card>
        <div className="stack stack-4">
          <CardHead
            title="What it covers"
            action={<span className="tiny muted">in the order the pass lists them</span>}
          />

          {entitlements.length === 0 ? (
            <Empty
              title="Nothing is attached to this pass yet"
              body="The pass exists but no venue has been added to it."
            />
          ) : (
            <div className="stack stack-3">
              {entitlements.map((e) => {
                const used = usedByEntitlement.get(e.id) ?? 0;
                const left = Math.max(0, e.allowance - used);
                const spent = holding && left === 0;

                return (
                  <div key={e.id} className="row-between panel">
                    <div className="stack stack-1">
                      <strong>{e.title}</strong>
                      {e.detail ? <span className="tiny muted">{e.detail}</span> : null}
                      <span className="tiny muted">
                        {/* `/explore/<ref>` never existed. This was the only
                            link to it anywhere, and it took a person to a 404 —
                            and Next, which prefetches links in view, fetched
                            three of them on every render of this page. Explore
                            searches by name, which is a real destination for
                            "show me this venue". */}
                        {e.venueName ? (
                          <Link href={`/explore?q=${encodeURIComponent(e.venueName)}`}>
                            {e.venueName}
                          </Link>
                        ) : (
                          (e.venueName ?? e.organizationName ?? 'Venue to be confirmed')
                        )}
                        {/* Venue names here routinely carry their own locality
                            ("Phoenix Cinemas — Viman Nagar"), so appending it
                            unconditionally printed the place twice. */}
                        {e.venueLocality && !(e.venueName ?? '').includes(e.venueLocality)
                          ? ` · ${e.venueLocality}`
                          : ''}
                        {e.venueKind ? ` · ${labelKind(e.venueKind)}` : ''}
                      </span>
                    </div>

                    <div className="stack stack-1" style={{ textAlign: 'right' }}>
                      <span className="mono">{formatMoney(e.listValueMinor, pass.currency)}</span>
                      <span className="tiny muted">list price</span>
                      {holding ? (
                        <Badge tone={spent ? 'neutral' : 'ok'}>
                          {spent ? 'used up' : `${left} of ${e.allowance} left`}
                        </Badge>
                      ) : (
                        <span className="tiny muted">
                          {e.allowance} {e.allowance === 1 ? 'admission' : 'admissions'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="tiny muted">
            Remaining allowances are counted from the uses recorded against your pass, not from a
            stored counter — so what this says is what the record says.
          </p>
        </div>
      </Card>
    </div>
  );
}
