/**
 * Travel mode — a stay, one day at a time.
 *
 * The same planner as `/plan`, given more days. `planTrip` books the room first
 * because it is the one cost that is neither optional nor divisible, then runs
 * the day solver on what is left of the budget; this screen renders that
 * structure rather than flattening it, because a trip total that hides which day
 * could not be filled is a number that reads as success.
 *
 * So every day gets its own section with its own cost, its own saving and its
 * own binding constraint, and a day the solver could not fill says so where the
 * items would have been. The trip total is the sum of what is above it and
 * nothing else.
 *
 * The concierge sits at the bottom, scoped to the venues the trip actually
 * chose. It answers out of rows and lists them; an answer with nothing behind it
 * is rendered as "I don't have that on file" rather than as an answer.
 */
import type { Metadata } from 'next';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHead,
  Empty,
  EstimateTag,
  Notice,
  PageHead,
  Stat,
  formatDate,
  formatDateTime,
  formatMoney,
} from '@/components/ui';
import { labelKind } from '@/components/consumer/format';
import { ConciergeForm, type ConciergeVenue } from '@/components/consumer/concierge-form';
import { discoverVenues, plannableCities } from '@/lib/assistant/catalog';
import {
  INTEREST_TAGS,
  INTEREST_VOCABULARY,
  PLANNER_GENERATOR,
  istDayStart,
  planTrip,
  type ChosenItem,
  type Interest,
  type TripDay,
  type TripPlan,
} from '@/lib/assistant/planner';
import { currentActor } from '../../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Travel mode',
  description: `A multi-day plan over live ${BRAND.name} inventory, with the room costed first and each day shown separately.`,
};

export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 2;
const DEFAULT_PARTY = 2;
const MAX_DAYS = 14;

interface Query {
  city?: string;
  from?: string;
  days?: string;
  party?: string;
  budget?: string;
  interest?: string | string[];
}

function interestLabel(tag: Interest): string {
  return INTEREST_VOCABULARY.find((d) => d.tag === tag)?.label ?? tag;
}

/** `YYYY-MM-DD` read as an Indian calendar day, not the server's. */
function readDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = new Date(`${value}T00:00:00+05:30`);
  return Number.isFinite(at.getTime()) ? istDayStart(at) : null;
}

function toDateInput(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
}

/** Rupees typed into a form → whole paise. Money stays an integer end to end. */
function paise(value: string | undefined): number | null {
  const raw = (value ?? '').trim().replace(/,/g, '');
  if (raw === '') return null;
  const rupees = Number(raw);
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  return Math.round(rupees * 100);
}

function wholeNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number((value ?? '').trim());
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function selectedInterests(value: string | string[] | undefined): Interest[] {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return INTEREST_TAGS.filter((tag) => raw.includes(tag));
}

function ItemRow({ item }: { item: ChosenItem }) {
  return (
    <Card as="li" className="stack stack-3">
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="grow">
          <p className="eyebrow">{formatDateTime(item.startsAt)}</p>
          <h4 className="h3">{item.venueName}</h4>
          <p className="small muted" style={{ marginTop: 2 }}>
            {[item.offerTitle ?? item.bandLabel, item.locality].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Badge tone="neutral">{labelKind(item.venueKind)}</Badge>
      </div>

      <div className="row-wrap">
        <span className="num" style={{ fontSize: 18 }}>
          {formatMoney(item.costMinor)}
        </span>
        {item.savingMinor > 0 ? <Badge tone="ok">Save {formatMoney(item.savingMinor)}</Badge> : null}
        {item.source === 'TYPICAL_SPEND' ? (
          <EstimateTag>Typical spend, not a price</EstimateTag>
        ) : (
          <Badge tone="info">Live offer</Badge>
        )}
      </div>

      {/* Verbatim. The solver built this sentence out of figures in rows. */}
      <div>
        <p className="eyebrow">Why it is here</p>
        <p className="small">{item.rationale}</p>
      </div>
    </Card>
  );
}

function DaySection({ day, index, interests }: { day: TripDay; index: number; interests: Interest[] }) {
  return (
    <section>
      <CardHead
        title={`Day ${index + 1} — ${formatDate(day.dayStart)}`}
        action={
          <span className="small">
            {formatMoney(day.totalCostMinor)}
            {day.totalSavingMinor > 0 ? (
              <span className="muted"> · {formatMoney(day.totalSavingMinor)} saved</span>
            ) : null}
          </span>
        }
      />

      <div className="stack stack-4">
        {day.chosen.length > 0 ? (
          <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {day.chosen.map((item) => (
              <ItemRow key={item.key} item={item} />
            ))}
          </ul>
        ) : (
          <Card>
            <Empty
              title="This day could not be filled"
              body="Nothing bookable fitted the day, the remaining budget and the times together. The constraint that stopped it is below."
            />
          </Card>
        )}

        {day.feasible ? (
          <p className="tiny muted">
            Every interest asked for is covered on this day, inside{' '}
            {day.dayBudgetMinor !== null ? formatMoney(day.dayBudgetMinor) : 'no budget cap'}, with no
            two items overlapping. {day.candidatesConsidered} candidate
            {day.candidatesConsidered === 1 ? '' : 's'} were considered.
          </p>
        ) : (
          <Notice tone="warn">
            <div className="stack stack-2">
              <strong>Day {index + 1} is not complete.</strong>
              {day.binding ? <span>{day.binding}</span> : null}
              {day.uncoveredInterests.length > 0 ? (
                <span>
                  Not covered on this day:{' '}
                  {day.uncoveredInterests.map((tag) => interestLabel(tag).toLowerCase()).join(', ')}.
                </span>
              ) : interests.length === 0 ? (
                <span>No interests were named, so the solver had nothing to cover.</span>
              ) : null}
            </div>
          </Notice>
        )}
      </div>
    </section>
  );
}

function TripOutput({ trip }: { trip: TripPlan }) {
  const unfilled = trip.days.filter((d) => d.chosen.length === 0);

  return (
    <>
      <section className="stat-row" aria-label="What the trip costs">
        <Stat
          label="Trip total"
          value={formatMoney(trip.totalCostMinor)}
          hint={
            trip.budgetMinor !== null
              ? `Of a ${formatMoney(trip.budgetMinor)} budget for ${trip.partySize} ${trip.partySize === 1 ? 'person' : 'people'}.`
              : `For ${trip.partySize} ${trip.partySize === 1 ? 'person' : 'people'}. No budget cap was set.`
          }
        />
        <Stat
          label="Against list price"
          value={formatMoney(trip.totalSavingMinor)}
          tone={trip.totalSavingMinor > 0 ? 'ok' : 'neutral'}
          hint="Summed from every item that has a list price to compare against."
        />
        <Stat
          label="Room for the stay"
          value={trip.accommodation ? formatMoney(trip.accommodationCostMinor) : '—'}
          hint={
            trip.accommodation
              ? `${trip.accommodationNights} ${trip.accommodationNights === 1 ? 'night' : 'nights'}, costed as one room.`
              : 'No room could be costed, so the trip total covers the days only.'
          }
        />
        <Stat
          label="Per day, after the room"
          value={trip.dayBudgetMinor !== null ? formatMoney(trip.dayBudgetMinor) : '—'}
          hint={
            trip.dayBudgetMinor !== null
              ? 'What each day had to spend. The solver never exceeds it.'
              : 'No budget was named, so no per-day cap was applied.'
          }
        />
      </section>

      {trip.feasible ? (
        <Notice tone="ok">
          Every day is complete: a room for the stay, and every interest you named covered on each
          day inside its share of the budget.
        </Notice>
      ) : (
        <Notice tone="warn">
          <div className="stack stack-2">
            <strong>This trip is not complete.</strong>
            {trip.binding ? <span>{trip.binding}</span> : null}
            {unfilled.length > 0 ? (
              <span>
                {unfilled.length} of {trip.days.length} day{trip.days.length === 1 ? '' : 's'} could
                not be filled at all:{' '}
                {unfilled.map((d) => formatDate(d.dayStart)).join(', ')}.
              </span>
            ) : null}
            <span className="small">
              The days below are shown as they came out. A day with nothing in it is left empty
              rather than padded, and a shorter trip is never presented as a complete one.
            </span>
          </div>
        </Notice>
      )}

      <section>
        <CardHead
          title={trip.title}
          action={<span className="mono tiny muted">{trip.itineraryRef}</span>}
        />
        {trip.accommodation ? (
          <Card className="stack stack-3">
            <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div className="grow">
                <p className="eyebrow">Where you sleep</p>
                <h3 className="h3">{trip.accommodation.venueName}</h3>
                <p className="small muted" style={{ marginTop: 2 }}>
                  {[trip.accommodation.offerTitle ?? trip.accommodation.bandLabel, trip.accommodation.locality]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <Badge tone="neutral">{labelKind(trip.accommodation.venueKind)}</Badge>
            </div>

            <div className="row-wrap">
              <span className="num" style={{ fontSize: 20 }}>
                {formatMoney(trip.accommodation.costMinor)}
              </span>
              {trip.accommodation.savingMinor > 0 ? (
                <Badge tone="ok">Save {formatMoney(trip.accommodation.savingMinor)}</Badge>
              ) : null}
              {trip.accommodation.source === 'TYPICAL_SPEND' ? (
                <EstimateTag>Typical rate, not a price</EstimateTag>
              ) : (
                <Badge tone="info">Live offer</Badge>
              )}
            </div>

            <div>
              <p className="eyebrow">Why it is here</p>
              <p className="small">{trip.accommodation.rationale}</p>
            </div>

            <p className="tiny muted">
              One room for the whole stay, whatever the party size. The planner has no way to know
              how many rooms {trip.partySize} {trip.partySize === 1 ? 'person wants' : 'people want'},
              so it does not decide.
            </p>
          </Card>
        ) : (
          <Card>
            <Empty
              title="No room could be costed"
              body="No hotel in this city has a live offer or a typical rate on file within the budget, so the stay is unpriced. The days below were solved without one."
            />
          </Card>
        )}
      </section>

      {trip.days.map((day, index) => (
        <DaySection key={day.dayStart.toISOString()} day={day} index={index} interests={trip.interests} />
      ))}
    </>
  );
}

export default async function TravelPage({ searchParams }: { searchParams: Promise<Query> }) {
  const actor = await currentActor();
  const params = await searchParams;
  const now = new Date();

  const cities = await plannableCities();

  const cityId = params.city && cities.some((c) => c.id === params.city) ? params.city : null;
  const from = readDateInput(params.from ?? '');
  const days = wholeNumber(params.days, DEFAULT_DAYS, 1, MAX_DAYS);
  const partySize = wholeNumber(params.party, DEFAULT_PARTY, 1, 20);
  const budgetMinor = paise(params.budget);
  const interests = selectedInterests(params.interest);

  // The plan is written under the signed-in actor and read back the same way.
  // A city id from the query is checked against the live city list before it
  // reaches the planner — not to protect anything private, but so a typo comes
  // back as "pick a city" rather than as an empty trip that looks like an answer.
  const trip: TripPlan | null =
    cityId && from
      ? await planTrip({
          userId: actor.userId,
          cityId,
          startsAt: from,
          days,
          budgetMinor,
          interests,
          partySize,
          prompt: `${days} days from ${toDateInput(from)}`,
          now,
        })
      : null;

  // Only the venues the trip actually chose. The concierge answers about one
  // venue, and offering a venue that is not in the plan would be a different
  // screen.
  const conciergeVenues: ConciergeVenue[] = trip
    ? [...(trip.accommodation ? [trip.accommodation] : []), ...trip.days.flatMap((d) => d.chosen)].reduce<
        ConciergeVenue[]
      >((acc, item) => {
        if (!acc.some((v) => v.venueId === item.venueId)) {
          acc.push({ venueId: item.venueId, name: item.venueName, locality: item.locality });
        }
        return acc;
      }, [])
    : [];

  // Nothing planned yet: show what is actually out there rather than an empty box.
  const cityStats = trip
    ? []
    : await Promise.all(
        cities.map(async (city) => {
          const venues = await discoverVenues({ cityId: city.id, limit: 100, now });
          return {
            city,
            venues: venues.length,
            liveOffers: venues.reduce((sum, v) => sum + v.liveOfferCount, 0),
            hotels: venues.filter((v) => v.kind === 'HOTEL').length,
          };
        }),
      );

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Travel mode"
        title="Plan a stay"
        lede={
          <>
            A room costed once for the stay, then each day solved separately out of what is live in
          that city. Every day shows its own cost, its own saving and the constraint that stopped
          it — including the days it could not fill.
          </>
        }
      />

      <Card>
        <form method="get" action="/travel/stay" className="stack stack-4">
          <div className="grid grid-2">
            <div className="field">
              <label className="label" htmlFor="travel-city">
                City
              </label>
              <select className="select input" id="travel-city" name="city" defaultValue={cityId ?? ''}>
                <option value="">Choose a city</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, {c.state}
                  </option>
                ))}
              </select>
              <p className="hint">Only cities that are live on {BRAND.name} can be planned.</p>
            </div>

            <div className="field">
              <label className="label" htmlFor="travel-from">
                Arriving
              </label>
              <input
                className="input"
                id="travel-from"
                name="from"
                type="date"
                defaultValue={params.from ?? toDateInput(now)}
                min={toDateInput(now)}
              />
              <p className="hint">Days are Indian calendar days, and no item is placed in the past.</p>
            </div>
          </div>

          <div className="grid grid-3">
            <div className="field">
              <label className="label" htmlFor="travel-days">
                Days
              </label>
              <input
                className="input"
                id="travel-days"
                name="days"
                type="number"
                min={1}
                max={MAX_DAYS}
                defaultValue={days}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="travel-party">
                People
              </label>
              <input
                className="input"
                id="travel-party"
                name="party"
                type="number"
                min={1}
                max={20}
                defaultValue={partySize}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="travel-budget">
                Budget for the whole trip (₹)
              </label>
              <input
                className="input"
                id="travel-budget"
                name="budget"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                defaultValue={params.budget ?? ''}
                placeholder="Leave blank for no cap"
              />
            </div>
          </div>

          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Interests</legend>
            <div className="row-wrap">
              {INTEREST_VOCABULARY.map((definition) => (
                <label key={definition.tag} className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    name="interest"
                    value={definition.tag}
                    defaultChecked={interests.includes(definition.tag)}
                  />
                  <span className="small">{definition.label}</span>
                </label>
              ))}
            </div>
            <p className="hint">
              Each one has to be covered on every day for the trip to count as complete. Leave them
              all off and the solver ranks on saving and price alone.
            </p>
          </fieldset>

          <div className="row-wrap">
            <Button type="submit" variant="primary">
              Plan the trip
            </Button>
            {trip ? (
              <ButtonLink href="/travel/stay" variant="ghost">
                Start again
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </Card>

      {params.city && !cityId ? (
        <Notice tone="bad">
          <span role="alert">
            That city is not one {BRAND.name} plans in. Pick one from the list — the list is the whole
            set of live cities.
          </span>
        </Notice>
      ) : null}

      {cityId && !from ? (
        <Notice tone="warn">
          Pick an arrival date. The planner will not choose one for you.
        </Notice>
      ) : null}

      {trip ? <TripOutput trip={trip} /> : null}

      {!trip ? (
        <section>
          <CardHead title="Where you can plan" />
          {cityStats.length > 0 ? (
            <ul className="grid grid-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {cityStats.map((stat) => (
                <Card as="li" key={stat.city.id} className="stack stack-3">
                  <div>
                    <h3 className="h3">{stat.city.name}</h3>
                    <p className="small muted" style={{ marginTop: 2 }}>
                      {stat.city.state}
                    </p>
                  </div>
                  <div className="row-wrap">
                    <Badge tone="neutral">
                      {stat.venues} venue{stat.venues === 1 ? '' : 's'}
                    </Badge>
                    {stat.liveOffers > 0 ? (
                      <Badge tone="ok" dot>
                        {stat.liveOffers} live offer{stat.liveOffers === 1 ? '' : 's'}
                      </Badge>
                    ) : (
                      <span className="tiny muted">Nothing live right now</span>
                    )}
                    <Badge tone={stat.hotels > 0 ? 'info' : 'warn'}>
                      {stat.hotels} place{stat.hotels === 1 ? '' : 's'} to stay
                    </Badge>
                  </div>
                  {stat.hotels === 0 ? (
                    <p className="tiny muted">
                      With no hotel on file, a stay here cannot be costed and the trip comes back
                      incomplete for that reason alone.
                    </p>
                  ) : null}
                </Card>
              ))}
            </ul>
          ) : (
            <Card>
              <Empty
                title="No cities are live"
                body={`Travel mode plans over real venues in cities partners have brought onto ${BRAND.name}. There are none yet.`}
                action={<ButtonLink href="/explore">Explore what exists</ButtonLink>}
              />
            </Card>
          )}
        </section>
      ) : null}

      <section>
        <ConciergeForm venues={conciergeVenues} />
      </section>

      <Card>
        <CardHead title="How this was decided" action={<Badge tone="neutral">No model connected</Badge>} />
        <p className="small">
          Method: <span className="mono">{PLANNER_GENERATOR}</span>. The trip is solved by the same
          deterministic solver as the day planner — the cheapest room that leaves a usable per-day
          budget, then a greedy pass per day ranked on interests covered, then saving, then price.
          It is <strong>not</strong> a large language model, and no AI model is connected to this
          screen or to the concierge below it. The concierge classifies a question by keyword and
          answers out of rows, or says it does not know.
        </p>
      </Card>
    </div>
  );
}
