/**
 * The warranty shelf.
 *
 * Three groups, and each one is a separate call to `listWarranties` with the
 * service's own status filter rather than a filter written here. "Expiring" means
 * the same sixty days the reminder sweep uses, decided by the same date
 * arithmetic — if the shelf and the reminder disagreed about what "soon" means,
 * one of them would be lying to the same person.
 *
 * ACTIVE includes EXPIRING, so the active list has the expiring ids removed rather
 * than being re-queried with a narrower window; the alternative is a second
 * definition of the boundary, which is the thing this arrangement avoids.
 *
 * Each one is drawn as the certificate it is, with the term as a bar rather than
 * two dates to subtract in your head. The proportion and its label come from
 * `warrantyTerm`, which the detail screen uses too — a shelf that rounded a lapse
 * differently from the screen behind it would be a shelf nobody could trust.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  ButtonLink,
  Card,
  Empty,
  Notice,
  PageHead,
  Stat,
  formatDate,
} from '@/components/ui';
import { Certificate } from '@/components/objects';
import { daysUntilIsoDate, describeDays } from '@/components/consumer/format';
import { warrantyTerm } from '@/components/consumer/warranty-shape';
import { EXPIRING_SOON_DAYS, listWarranties } from '@/lib/commerce/warranties';
import { currentActor } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Warranties',
  description: 'What is still under cover, what lapses soon, and what has run out.',
};

export const dynamic = 'force-dynamic';

type Row = Awaited<ReturnType<typeof listWarranties>>[number];

function WarrantyCertificate({ row, now }: { row: Row; now: Date }) {
  const { warranty, receipt, organization } = row;
  const term = warrantyTerm(warranty, now, describeDays);

  return (
    <li>
      <Certificate seed={warranty.publicRef} className={term.lapsed ? 'certificate-spent' : undefined}>
        <div className="stack stack-3">
          <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s-3)' }}>
            <Certificate.Seal />
            <div className="stack stack-1" style={{ minWidth: 0 }}>
              <p className="eyebrow">{organization?.name ?? 'Merchant not recorded'}</p>
              <h3 className="h3">
                <Link href={`/warranties/${warranty.publicRef}`}>{warranty.productName}</Link>
              </h3>
              <p className="tiny muted">
                {warranty.months} month{warranty.months === 1 ? '' : 's'} from {formatDate(warranty.purchasedOn)}
              </p>
            </div>
          </div>

          <div className="stack stack-2">
            <div
              className="timeline-bar"
              data-tone={term.lapsed ? 'bad' : term.expiringSoon ? 'warn' : undefined}
              role="meter"
              aria-label={`Cover used on ${warranty.productName}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={term.percentUsed}
              aria-valuetext={`${term.percentUsed} per cent of the term used`}
            >
              <span className="elapsed" style={{ width: `${term.percentUsed}%` }} />
            </div>
            <div className="row-between tiny muted">
              <span>Bought {formatDate(warranty.purchasedOn)}</span>
              <span>
                {term.lapsed ? 'Lapsed' : 'Ends'} {formatDate(warranty.expiresOn)}
              </span>
            </div>
          </div>

          {warranty.serialNumber ? (
            <p className="tiny mono muted">Serial {warranty.serialNumber}</p>
          ) : null}

          <div className="row-between">
            <Badge tone={term.tone}>{term.label}</Badge>
            {receipt ? (
              <Link className="tiny" href={`/receipts/${receipt.publicRef}`}>
                The receipt →
              </Link>
            ) : null}
          </div>
        </div>
      </Certificate>
    </li>
  );
}

export default async function WarrantiesPage() {
  const actor = await currentActor();
  const now = new Date();

  const [activeAll, expiring, expired] = await Promise.all([
    listWarranties({ userId: actor.userId, status: 'ACTIVE', now }),
    listWarranties({ userId: actor.userId, status: 'EXPIRING', now }),
    listWarranties({ userId: actor.userId, status: 'EXPIRED', now }),
  ]);

  const expiringIds = new Set(expiring.map((r) => r.warranty.id));
  const active = activeAll.filter((r) => !expiringIds.has(r.warranty.id));

  const total = activeAll.length + expired.length;
  const soonest = expiring[0];

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Product cover"
        title="Warranties"
        lede="Derived from your receipts at the moment they were issued, and dated by the merchant’s own terms on the day you bought."
        actions={
          <ButtonLink href="/receipts" size="sm" variant="ghost">
            Receipts behind them
          </ButtonLink>
        }
      />

      {total > 0 ? (
        <section className="stat-row" aria-label="Cover at a glance">
          <Stat label="Under cover" value={activeAll.length} hint="Still inside the merchant’s warranty period." />
          <Stat
            label={`Lapsing within ${EXPIRING_SOON_DAYS} days`}
            value={expiring.length}
            tone={expiring.length > 0 ? 'warn' : undefined}
            hint={
              soonest
                ? `Soonest: ${soonest.warranty.productName}, ${describeDays(daysUntilIsoDate(soonest.warranty.expiresOn, now))}.`
                : 'Nothing is close to lapsing.'
            }
          />
          <Stat label="Lapsed" value={expired.length} hint="Kept as a record of what was covered and when." />
        </section>
      ) : null}

      {expiring.length > 0 ? (
        <Notice tone="warn">
          <span>
            {expiring.length} item{expiring.length === 1 ? '' : 's'} lapse{expiring.length === 1 ? 's' : ''} within{' '}
            {EXPIRING_SOON_DAYS} days. {BRAND.name} reminds you once per warranty, so this list is the fuller
            picture.
          </span>
        </Notice>
      ) : null}

      {/* Only when there is something in it. A section whose whole content is
          "nothing here" is worth a line, not a third of the screen — and this one
          would otherwise be the first thing under the heading on most accounts. */}
      {expiring.length > 0 ? (
        <section className="stack stack-4" aria-labelledby="expiring-heading">
          <div className="section-head">
            <h2 id="expiring-heading">Lapsing within {EXPIRING_SOON_DAYS} days</h2>
          </div>
          <ul className="shelf shelf-wide stagger">
            {expiring.map((row) => (
              <WarrantyCertificate key={row.warranty.id} row={row} now={now} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack stack-4" aria-labelledby="active-heading">
        <div className="section-head">
          <h2 id="active-heading">Under cover</h2>
        </div>
        {active.length > 0 ? (
          <ul className="shelf shelf-wide stagger">
            {active.map((row) => (
              <WarrantyCertificate key={row.warranty.id} row={row} now={now} />
            ))}
          </ul>
        ) : (
          <Card>
            <Empty
              title={activeAll.length > 0 ? 'Everything under cover is in the list above' : 'Nothing under cover'}
              body={
                activeAll.length > 0
                  ? `Every active warranty on this account is inside its final ${EXPIRING_SOON_DAYS} days.`
                  : 'A warranty is created automatically when a merchant marks a receipt line as carrying one.'
              }
              action={
                activeAll.length > 0 ? undefined : (
                  <ButtonLink href="/receipts" variant="primary">
                    See your receipts
                  </ButtonLink>
                )
              }
            />
          </Card>
        )}
      </section>

      {expired.length > 0 ? (
        <section className="stack stack-4" aria-labelledby="lapsed-heading">
          <div className="section-head">
            <h2 id="lapsed-heading">Lapsed</h2>
            <span className="small muted">Kept as a record of what was covered and when.</span>
          </div>
          <ul className="shelf shelf-wide stagger">
            {expired.map((row) => (
              <WarrantyCertificate key={row.warranty.id} row={row} now={now} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
