/**
 * The booking screen: re-check the price, take the passengers, then pay.
 *
 * Three things happen in order here, and the order is the safety property:
 *
 *  1. **The airline is asked again.** The fare on the results page is a quote
 *     from minutes ago. Before a payment exists, the provider is asked what it
 *     costs now, and if the figure moved the customer is shown the old one, the
 *     new one and the difference, and asked. Until they accept, there is no
 *     button that charges anything — the state machine has no edge from
 *     PRICE_CHANGED to PAYMENT_PENDING.
 *
 *  2. **The passengers are collected**, with the rules the airline enforces
 *     stated on the fields rather than discovered when the booking is rejected.
 *
 *  3. **The total is computed on the server** and shown in full: every charge as
 *     its own line, every discount as its own subtraction, and cashback shown
 *     separately because it is credited later rather than taken off now.
 *
 * The progress bar at the top is the real state machine, not a happy path drawn
 * five times. `PAYMENT_FAILED` (no money, no seat) and `BOOKING_FAILED` (money
 * taken, no seat) stop at different stations and always will — see
 * `components/travel/booking-progress.tsx`.
 *
 * Bank offers are listed whether or not they apply, with the reason beside the
 * ones that do not. A customer with an HDFC card wants to know the HDFC offer
 * exists and needs ₹5,000 of spend — not to wonder why they never see it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { flightBookings, flightSegments } from '@/db/schema';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHead,
  Field,
  Notice,
  Stack,
  Steps,
  formatMoney,
  formatDateTime,
} from '@/components/ui';
import { FeatureNote } from '@/components/system';
import { bookingSteps } from '@/components/travel/booking-progress';
import { cabinLabel, clock, dayLabel, duration, stopsLabel } from '@/components/travel/format';
import { humanise, nextStep, type BookingState } from '@/lib/travel/booking-state';
import { priceBooking, platformFeeFor } from '@/lib/travel/pricing';
import { walletSummary } from '@/lib/commerce/rewards';
import { currentActor } from '../../../_queries';
import { airlineNames, airportsByCode } from '../../_queries';
import { acceptPriceAction, payAction, revalidateAction } from '../../actions';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Confirm your booking',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { ref } = await params;
  const { done, error } = await searchParams;
  const actor = await currentActor();

  const booking = await db.query.flightBookings.findFirst({
    where: eq(flightBookings.publicRef, ref),
    with: { passengers: true },
  });
  // Somebody else's booking does not exist, rather than being forbidden — a 403
  // would confirm the reference is real.
  if (!booking || booking.userId !== actor.userId) notFound();

  // Already paid for. The trip page is where a paid booking lives.
  const settled: BookingState[] = ['PAYMENT_AUTHORIZED', 'BOOKING_PENDING', 'CONFIRMED', 'TICKETED', 'REFUNDED'];
  const isSettled = settled.includes(booking.state);

  const segments = booking.offerId
    ? await db.query.flightSegments.findMany({
        where: eq(flightSegments.offerId, booking.offerId),
        orderBy: [flightSegments.sliceIndex, flightSegments.position],
      })
    : [];

  const [airlines, places, wallet] = await Promise.all([
    airlineNames(),
    airportsByCode([booking.originCode, booking.destinationCode]),
    walletSummary(actor.userId),
  ]);

  // The whole calculation, so the page renders exactly what would be charged.
  // Points are quoted at zero here; the customer chooses how many to spend and
  // the figure is re-derived on submit from the value they sent.
  const breakdown = await priceBooking({
    userId: actor.userId,
    baseMinor: booking.baseMinor,
    taxMinor: booking.taxMinor,
    providerFeeMinor: booking.providerFeeMinor,
    seatFeeMinor: booking.seatFeeMinor,
    baggageFeeMinor: booking.baggageFeeMinor,
    currency: booking.currency,
    cabin: booking.cabin,
    marketingCarrier: booking.marketingCarrier,
    originCode: booking.originCode,
    destinationCode: booking.destinationCode,
    passengerCount: booking.passengerCount,
    bankOfferRef: null,
    pointsToSpend: 0,
  });

  const state = booking.state as BookingState;
  const needsRevalidation = state === 'OFFER_SELECTED' || state === 'REVALIDATION_FAILED';
  const priceChanged = state === 'PRICE_CHANGED';
  const canPay = state === 'PRICE_CONFIRMED' || state === 'PAYMENT_PENDING' || state === 'PAYMENT_FAILED';
  const difference = (booking.confirmedTotalMinor ?? booking.selectedTotalMinor) - booking.selectedTotalMinor;
  const step = nextStep(state);
  const steps = bookingSteps(
    state,
    { revalidatedAt: booking.revalidatedAt, confirmedAt: booking.confirmedAt, ticketedAt: booking.ticketedAt },
    formatDateTime,
  );

  return (
    <div className="wrap stack stack-5">
      <header className="page-head">
        <div className="page-head-text">
          <p className="eyebrow">
            <Link href="/travel">Travel</Link> · Booking {booking.publicRef}
          </p>
          <h1>
            {places.get(booking.originCode)?.city ?? booking.originCode} to{' '}
            {places.get(booking.destinationCode)?.city ?? booking.destinationCode}
          </h1>
          <p>
            {airlines.get(booking.marketingCarrier) ?? booking.marketingCarrier} ·{' '}
            {dayLabel(booking.departAt)} · {cabinLabel(booking.cabin)} · {booking.passengerCount} passenger
            {booking.passengerCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="page-head-actions">
          <Badge tone={priceChanged ? 'warn' : booking.revalidatedAt ? 'ok' : 'neutral'}>
            {humanise(state)}
          </Badge>
          {booking.source === 'SAMPLE' ? <Badge tone="warn">Sample fare</Badge> : null}
        </div>
      </header>

      {done ? <Notice tone="info">{done}</Notice> : null}
      {error ? <Notice tone="warn">{error}</Notice> : null}

      {steps ? (
        <Card>
          <Stack gap={3}>
            <Steps label="Where this booking has got to" steps={steps} />
            {step ? <p className="small muted">{step}</p> : null}
          </Stack>
        </Card>
      ) : (
        <Notice tone="neutral">This booking is {humanise(state)}. It stopped there.</Notice>
      )}

      {isSettled ? (
        <Card>
          <Stack gap={3}>
            <CardHead title="This booking has been paid for" />
            <p className="small">
              Nothing further is needed here. The trip page shows where the booking has got to with the
              airline, as the payment provider and the airline report it.
            </p>
            <ButtonLink href={`/travel/trips/${booking.publicRef}`} variant="primary">
              Open the trip
            </ButtonLink>
          </Stack>
        </Card>
      ) : null}

      {segments.length > 0 ? (
        <Card>
          <Stack gap={3}>
            <CardHead title="Your journey" />
            <ul className="stack stack-2">
              {segments.map((leg) => (
                <li key={leg.id} className="small">
                  <strong>
                    {clock(leg.departAt)} {leg.originCode}
                  </strong>{' '}
                  →{' '}
                  <strong>
                    {clock(leg.arriveAt)} {leg.destinationCode}
                  </strong>{' '}
                  <span className="muted">
                    {leg.marketingCarrier} {leg.flightNumber} · {duration(leg.durationMinutes)}
                    {leg.aircraft ? ` · ${leg.aircraft}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="tiny muted">
              {stopsLabel(Math.max(0, segments.filter((leg) => leg.sliceIndex === 0).length - 1))} outbound
            </p>
          </Stack>
        </Card>
      ) : null}

      {/* ── 1. the airline is asked again ── */}
      {!isSettled ? (
        <Card>
          <Stack gap={4}>
            <CardHead title="The price, checked with the airline" />

            {needsRevalidation ? (
              <>
                <p className="small">
                  The fare you picked was quoted a few minutes ago. Before anything is charged, the
                  airline is asked what it costs right now. Nothing on this screen has taken any money.
                </p>
                {state === 'REVALIDATION_FAILED' ? (
                  <Notice tone="warn">
                    {booking.failureDetail ?? 'This fare is no longer available.'} You can ask again, or
                    search for what is available now.
                  </Notice>
                ) : null}
                <div className="row-wrap">
                  <form action={revalidateAction}>
                    <input type="hidden" name="ref" value={booking.publicRef} />
                    <Button type="submit" variant="primary">
                      Check the price with the airline
                    </Button>
                  </form>
                  {state === 'REVALIDATION_FAILED' ? (
                    <ButtonLink href="/travel/flights" variant="ghost">
                      Search again instead
                    </ButtonLink>
                  ) : null}
                </div>
              </>
            ) : null}

            {priceChanged ? (
              <>
                <Notice tone="warn">
                  The airline has changed this fare. Nothing has been charged, and nothing will be until
                  you say so.
                </Notice>
                <div className="op-was-now">
                  <div>
                    <p className="stat-label">What you were shown</p>
                    <p className="figure">{formatMoney(booking.selectedTotalMinor)}</p>
                  </div>
                  <div>
                    <p className="stat-label">What the airline charges now</p>
                    <p className="figure">{formatMoney(booking.confirmedTotalMinor ?? 0)}</p>
                    <p className="small muted">
                      {difference > 0 ? 'More' : 'Less'} by {formatMoney(Math.abs(difference))}
                    </p>
                  </div>
                </div>
                <div className="row-wrap">
                  <form action={acceptPriceAction}>
                    <input type="hidden" name="ref" value={booking.publicRef} />
                    <Button type="submit" variant="primary">
                      Accept {formatMoney(booking.confirmedTotalMinor ?? 0)}
                    </Button>
                  </form>
                  <ButtonLink href="/travel/flights" variant="ghost">
                    Search again instead
                  </ButtonLink>
                </div>
              </>
            ) : null}

            {state === 'PRICE_CONFIRMED' && booking.revalidatedAt ? (
              <p className="small">
                The airline confirmed{' '}
                <strong>{formatMoney(booking.confirmedTotalMinor ?? booking.selectedTotalMinor)}</strong> at{' '}
                {clock(booking.revalidatedAt)}. This price is good for a few minutes; if it lapses the
                airline is simply asked again.
              </p>
            ) : null}

            {state === 'PAYMENT_FAILED' ? (
              <Notice tone="warn">
                The last payment attempt did not go through. <strong>Nothing was charged</strong>, and no
                points were spent — points come off on capture, not at submit. You can try again below.
              </Notice>
            ) : null}
          </Stack>
        </Card>
      ) : null}

      {/* ── 2 and 3: passengers, discounts and the total ── */}
      {canPay ? (
        <form action={payAction}>
          <input type="hidden" name="ref" value={booking.publicRef} />
          <input type="hidden" name="passengerCount" value={booking.passengerCount} />

          <Stack gap={5}>
            <Card>
              <Stack gap={4}>
                <CardHead title="Who is travelling" />
                <p className="small muted">
                  Names have to match the photo identification each passenger will carry. An airline will
                  refuse boarding on a mismatch, and most charge to correct one.
                </p>

                <div>
                  {Array.from({ length: booking.passengerCount }, (_, index) => (
                    <fieldset key={index} className="op-pax">
                      <legend className="eyebrow">Passenger {index + 1}</legend>
                      <div className="op-pax-grid">
                        <Field label="Given name" htmlFor={`given-${index}`}>
                          <input
                            id={`given-${index}`}
                            name={`given-${index}`}
                            className="input"
                            autoComplete="given-name"
                            maxLength={80}
                            required
                            defaultValue={booking.passengers[index]?.givenName ?? ''}
                          />
                        </Field>
                        <Field label="Family name" htmlFor={`family-${index}`}>
                          <input
                            id={`family-${index}`}
                            name={`family-${index}`}
                            className="input"
                            autoComplete="family-name"
                            maxLength={80}
                            required
                            defaultValue={booking.passengers[index]?.familyName ?? ''}
                          />
                        </Field>
                        <Field label="Title" htmlFor={`title-${index}`}>
                          <select
                            id={`title-${index}`}
                            name={`title-${index}`}
                            className="select"
                            defaultValue={booking.passengers[index]?.title ?? 'Mr'}
                          >
                            <option>Mr</option>
                            <option>Ms</option>
                            <option>Mrs</option>
                            <option>Dr</option>
                          </select>
                        </Field>
                        <Field
                          label="Date of birth"
                          htmlFor={`dob-${index}`}
                          hint="Required by the airline for fare eligibility"
                        >
                          <input
                            id={`dob-${index}`}
                            name={`dob-${index}`}
                            type="date"
                            className="input"
                            max={new Date().toISOString().slice(0, 10)}
                            defaultValue={booking.passengers[index]?.dateOfBirth ?? ''}
                          />
                        </Field>
                        <Field
                          label="Passenger type"
                          htmlFor={`kind-${index}`}
                          hint="Adult 12+, child 2–11, infant under 2"
                        >
                          <select
                            id={`kind-${index}`}
                            name={`kind-${index}`}
                            className="select"
                            defaultValue={booking.passengers[index]?.kind ?? 'ADULT'}
                          >
                            <option value="ADULT">Adult</option>
                            <option value="CHILD">Child</option>
                            <option value="INFANT">Infant on a lap</option>
                          </select>
                        </Field>
                        <Field
                          label="Passport or ID number"
                          htmlFor={`doc-${index}`}
                          hint="Only needed on international routes. Encrypted, and never shown again in full."
                        >
                          <input
                            id={`doc-${index}`}
                            name={`doc-${index}`}
                            className="input input-mono"
                            maxLength={20}
                            autoComplete="off"
                            placeholder={
                              booking.passengers[index]?.documentLast2
                                ? `•••• ${booking.passengers[index]!.documentLast2}`
                                : ''
                            }
                          />
                        </Field>
                      </div>
                    </fieldset>
                  ))}
                </div>

                <div className="op-pax-grid">
                  <Field
                    label="Email for the airline"
                    htmlFor="contactEmail"
                    hint="Where the airline sends the ticket"
                  >
                    <input
                      id="contactEmail"
                      name="contactEmail"
                      type="email"
                      className="input"
                      autoComplete="email"
                      required
                      defaultValue={actor.email ?? ''}
                    />
                  </Field>
                  <Field
                    label="Phone for the airline"
                    htmlFor="contactPhone"
                    hint="For schedule changes and disruptions"
                  >
                    <input
                      id="contactPhone"
                      name="contactPhone"
                      type="tel"
                      className="input"
                      autoComplete="tel"
                      required
                    />
                  </Field>
                </div>
              </Stack>
            </Card>

            <Card>
              <Stack gap={4}>
                <CardHead title="Bank offers" />
                <p className="small muted">
                  A bank offer comes off the fare when you pay with that instrument. It is applied by the
                  payment provider — {BRAND.name} shows the discount only when the payment system actually
                  takes it off. Offers that do not apply to this booking are listed too, with the reason.
                </p>

                <div className="op-offers">
                  <label className="op-offer">
                    <input type="radio" name="bankOffer" value="" defaultChecked />
                    <span>
                      <strong>No bank offer</strong>
                      <span className="small muted" style={{ display: 'block' }}>
                        Pay the full fare.
                      </span>
                    </span>
                  </label>

                  {breakdown.bankOffers.map((offer) => (
                    <label key={offer.ref} className={`op-offer ${offer.eligible ? '' : 'op-offer-off'}`}>
                      <input type="radio" name="bankOffer" value={offer.ref} disabled={!offer.eligible} />
                      <span>
                        <strong>
                          {offer.issuer} — {offer.title}
                        </strong>{' '}
                        {offer.eligible ? (
                          <Badge tone="ok">saves {formatMoney(offer.discountMinor)}</Badge>
                        ) : (
                          <Badge tone="neutral">not applicable</Badge>
                        )}
                        <span className="small muted" style={{ display: 'block' }}>
                          {offer.reason ?? offer.terms}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <FeatureNote featureKey="bank-offers" />
              </Stack>
            </Card>

            <Card>
              <Stack gap={4}>
                <CardHead title={`${BRAND.name} points`} />
                <p className="small">
                  You have <strong>{wallet.totalPoints.toLocaleString('en-IN')}</strong> points, worth{' '}
                  {formatMoney(wallet.totalValueMinor)}. Points come off what is left after a bank offer,
                  so you never spend them on money the bank was already paying — and they are taken when
                  the payment is captured, not when you submit, so a declined card does not cost you your
                  balance.
                </p>
                <Field
                  label="Points to spend"
                  htmlFor="points"
                  hint="Only what is needed is taken; the rest stays in your balance."
                >
                  <input
                    id="points"
                    name="points"
                    type="number"
                    className="input"
                    min={0}
                    max={wallet.totalPoints}
                    step={1}
                    defaultValue={0}
                    inputMode="numeric"
                  />
                </Field>
              </Stack>
            </Card>

            <Card>
              <Stack gap={4}>
                <CardHead title="What you pay" />
                <div>
                  {breakdown.lines.map((line) => (
                    <div key={line.key} className="op-price-row">
                      <span>
                        {line.label}
                        {line.note ? (
                          <span className="tiny muted" style={{ display: 'block' }}>
                            {line.note}
                          </span>
                        ) : null}
                      </span>
                      <span className={`num ${line.isDiscount ? 'op-discount' : ''}`}>
                        {line.isDiscount ? '−' : ''}
                        {formatMoney(line.amountMinor)}
                      </span>
                    </div>
                  ))}
                  <div className="op-price-row">
                    <span className="op-price-total">Total before discounts</span>
                    <span className="op-price-total num">{formatMoney(breakdown.grossMinor)}</span>
                  </div>
                </div>

                <p className="small muted">
                  The figure you are charged is computed on the server when you submit, from the price the
                  airline confirmed and the choices above — the form carries which offer and how many
                  points, never what any of them is worth. The exact amount appears on the payment screen
                  before you enter anything.
                </p>

                {breakdown.cashback ? (
                  <Notice tone="info">
                    <strong>{formatMoney(breakdown.cashback.amountMinor)} cashback</strong> on this booking
                    — {breakdown.cashback.method}. It is credited as {BRAND.name} points after{' '}
                    {dayLabel(breakdown.cashback.approveAfter)}, once the airline’s cancellation window has
                    passed. <strong>It is not taken off what you pay now.</strong>
                  </Notice>
                ) : null}

                <Button type="submit" variant="primary" size="lg" block>
                  Continue to payment
                </Button>

                <p className="tiny muted">
                  {BRAND.name} never sees your card number, CVV or UPI PIN. Payment is collected on the
                  provider’s own surface, and this booking is confirmed with the airline only after the
                  provider’s signed confirmation reaches our server.
                </p>
              </Stack>
            </Card>
          </Stack>
        </form>
      ) : null}

      {!canPay && !isSettled && !needsRevalidation && !priceChanged ? (
        <Notice tone="warn">{step ?? `This booking is ${humanise(state)}.`}</Notice>
      ) : null}

      <p className="tiny muted">
        Reference {booking.publicRef} · fare from{' '}
        {booking.source === 'SAMPLE' ? 'the development sample source' : booking.source} ·{' '}
        {platformFeeFor(booking.baseMinor) > 0
          ? `includes a ${BRAND.name} service fee, shown above`
          : `no ${BRAND.name} service fee on this booking`}
      </p>
    </div>
  );
}
