/**
 * The bank offers and cashback rules that are running.
 *
 * Every offer in full, with its terms, rather than a headline and a link to
 * terms nobody opens. An offer whose conditions are not shown beside it is an
 * offer that will disappoint somebody at checkout, and the disappointment is
 * always at the moment they were about to pay.
 *
 * Offers that have not started or have ended are shown too, marked as such. A
 * customer who saw an offer last week and cannot find it today deserves to know
 * it ended rather than to wonder whether they imagined it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { bankOffers, cashbackRules } from '@/db/schema';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  Empty,
  Notice,
  PageHead,
  Stack,
  formatDate,
  formatMoney,
} from '@/components/ui';
import { cabinLabel } from '@/components/travel/format';
import type { Cabin } from '@/lib/travel/providers/types';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Travel discounts',
  description: `The bank offers and cashback rules running on ${BRAND.name} travel bookings, with their full terms.`,
};

export const dynamic = 'force-dynamic';

const INSTRUMENT: Record<string, string> = {
  CREDIT_CARD: 'Credit card',
  DEBIT_CARD: 'Debit card',
  UPI: 'UPI',
  NETBANKING: 'Netbanking',
  WALLET: 'Wallet',
  EMI: 'EMI',
};

export default async function DiscountsPage() {
  const now = new Date();

  const [offers, rules] = await Promise.all([
    db
      .select()
      .from(bankOffers)
      .where(eq(bankOffers.active, true))
      .orderBy(desc(bankOffers.endsAt), asc(bankOffers.issuer))
      .limit(50),
    db
      .select()
      .from(cashbackRules)
      .where(
        and(
          eq(cashbackRules.active, true),
          lte(cashbackRules.startsAt, now),
          or(isNull(cashbackRules.endsAt), gte(cashbackRules.endsAt, now)),
        ),
      )
      .orderBy(desc(cashbackRules.percentBp))
      .limit(20),
  ]);

  const live = offers.filter((offer) => offer.startsAt <= now && offer.endsAt >= now);
  const upcoming = offers.filter((offer) => offer.startsAt > now);
  const ended = offers.filter((offer) => offer.endsAt < now);

  return (
    // The horizontal container. `(app)/layout.tsx` supplies vertical rhythm
    // only, so a page without this renders edge to edge beside neighbours that
    // have gutters — which reads as a broken page rather than a different one.
    <div className="wrap stack stack-5">

      <PageHead
        eyebrow={
          <>
            <Link href="/travel">Travel</Link> · Discounts
          </>
        }
        title="Offers on travel bookings"
        lede={
          <>
            Bank offers come off the fare when you pay with the instrument they name. Cashback is credited
          as points afterwards. Both are shown in full here, with the conditions, so nothing is a
          surprise at checkout.
          </>
        }
      />

      <Notice tone="info">
        A bank offer is applied by the payment provider when the payment is made. {BRAND.name} shows a
        discount as applied only when the payment system actually took it off — never in advance, and
        never as an estimate.
      </Notice>

      {live.length === 0 && upcoming.length === 0 && rules.length === 0 ? (
        <Empty
          title="No offers are running"
          body="When a bank campaign or a cashback rule is configured on this deployment, it appears here with its full terms."
          action={<ButtonLink href="/travel/flights">Search flights</ButtonLink>}
        />
      ) : null}

      {live.length > 0 ? (
        <Card>
          <Stack gap={4}>
            <CardHead title="Bank offers running now" />
            <div className="op-offer-grid">
              {live.map((offer) => (
                <OfferCard key={offer.id} offer={offer} />
              ))}
            </div>
          </Stack>
        </Card>
      ) : null}

      {rules.length > 0 ? (
        <Card>
          <Stack gap={4}>
            <CardHead title="Cashback" />
            <p className="small muted">
              The best single rule applies to a booking — cashback does not stack. It is credited as{' '}
              {BRAND.name} points once the airline’s cancellation window has passed.
            </p>
            <div className="op-offer-grid">
              {rules.map((rule) => (
                <div key={rule.id} className="op-offer-card">
                  <p className="op-offer-headline">{rule.name}</p>
                  <div className="row-wrap">
                    <Badge tone="ok">
                      {rule.percentBp > 0 ? `${(rule.percentBp / 100).toFixed(rule.percentBp % 100 === 0 ? 0 : 2)}% back` : `${formatMoney(rule.flatMinor)} back`}
                    </Badge>
                    {rule.maxCashbackMinor !== null ? (
                      <Badge tone="neutral">up to {formatMoney(rule.maxCashbackMinor)}</Badge>
                    ) : null}
                    {rule.minSpendMinor > 0 ? (
                      <Badge tone="neutral">min {formatMoney(rule.minSpendMinor)}</Badge>
                    ) : null}
                    {(rule.cabins ?? []).length > 0 ? (
                      <Badge tone="neutral">
                        {(rule.cabins ?? []).map((cabin) => cabinLabel(cabin as Cabin)).join(', ')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="small">{rule.description}</p>
                  <p className="tiny muted">
                    Credited {rule.holdDays} days after the booking confirms. Expires {rule.expiryDays}{' '}
                    days after that if not credited.
                  </p>
                </div>
              ))}
            </div>
          </Stack>
        </Card>
      ) : null}

      {upcoming.length > 0 ? (
        <Card>
          <Stack gap={4}>
            <CardHead title="Starting soon" />
            <div className="op-offer-grid">
              {upcoming.map((offer) => (
                <OfferCard key={offer.id} offer={offer} />
              ))}
            </div>
          </Stack>
        </Card>
      ) : null}

      {ended.length > 0 ? (
        <Card>
          <Stack gap={4}>
            <CardHead title="Ended" />
            <p className="small muted">
              Shown so an offer you remember can be confirmed as over rather than simply missing.
            </p>
            <div className="op-offer-grid">
              {ended.slice(0, 8).map((offer) => (
                <OfferCard key={offer.id} offer={offer} past />
              ))}
            </div>
          </Stack>
        </Card>
      ) : null}

      <p className="tiny muted">
        {BRAND.name} never sees your card number. A bank offer is matched on the issuer and instrument you
        choose at checkout, which the payment provider reports back — there is no column anywhere in
        this system that could hold a card or a BIN range.
      </p>
    </div>
  );
}

function OfferCard({ offer, past = false }: { offer: typeof bankOffers.$inferSelect; past?: boolean }) {
  const cabins = offer.cabins ?? [];
  const carriers = offer.carriers ?? [];

  return (
    <div className={`op-offer-card ${past ? 'op-offer-card-past' : ''}`}>
      <p className="eyebrow">
        {offer.issuer} · {INSTRUMENT[offer.instrument] ?? offer.instrument}
      </p>
      <p className="op-offer-headline">{offer.title}</p>

      <div className="row-wrap">
        {offer.percentOffBp > 0 ? (
          <Badge tone={past ? 'neutral' : 'ok'}>
            {(offer.percentOffBp / 100).toFixed(offer.percentOffBp % 100 === 0 ? 0 : 2)}% off
          </Badge>
        ) : null}
        {offer.flatOffMinor > 0 ? (
          <Badge tone={past ? 'neutral' : 'ok'}>{formatMoney(offer.flatOffMinor)} off</Badge>
        ) : null}
        {offer.maxDiscountMinor !== null ? (
          <Badge tone="neutral">up to {formatMoney(offer.maxDiscountMinor)}</Badge>
        ) : null}
        {offer.minSpendMinor > 0 ? (
          <Badge tone="neutral">min spend {formatMoney(offer.minSpendMinor)}</Badge>
        ) : null}
        {offer.perUserLimit !== null ? (
          <Badge tone="neutral">
            {offer.perUserLimit === 1 ? 'once per customer' : `${offer.perUserLimit} per customer`}
          </Badge>
        ) : null}
        {cabins.length > 0 ? (
          <Badge tone="neutral">{cabins.map((cabin) => cabinLabel(cabin as Cabin)).join(', ')}</Badge>
        ) : null}
        {carriers.length > 0 ? <Badge tone="neutral">{carriers.join(', ')} only</Badge> : null}
        {past ? <Badge tone="neutral">ended {formatDate(offer.endsAt)}</Badge> : null}
      </div>

      {/* The full terms, always, beside the offer rather than behind a link. */}
      <p className="small">{offer.terms}</p>

      <p className="tiny muted">
        {past
          ? `Ran from ${formatDate(offer.startsAt)} to ${formatDate(offer.endsAt)}.`
          : `Valid ${formatDate(offer.startsAt)} to ${formatDate(offer.endsAt)}.`}
      </p>
    </div>
  );
}
