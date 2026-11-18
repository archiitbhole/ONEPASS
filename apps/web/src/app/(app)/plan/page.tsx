/**
 * Plan my day.
 *
 * The screen over `lib/assistant/planner`. It does three things and nothing else:
 * it hands a sentence to the parser, it shows what the parser made of it *before*
 * the plan, and it prints the solver's own rationale for each item without
 * touching a word of it.
 *
 * Showing the interpretation first is the property that matters. A planner that
 * silently reads "under ₹2,000" as a budget of two thousand and "Saturday" as
 * this coming Saturday is right most of the time; the times it is wrong, the
 * person has no way to tell, because all they see is a plan that looks
 * plausible. So the parse is rendered as a list of fields with "not stated"
 * written where the sentence said nothing — and the words the parser could not
 * use are printed too, rather than quietly dropped.
 *
 * Nothing on this page is generated text. `PLANNER_GENERATOR` names the exact
 * algorithm that ran, the rationale strings are arithmetic over rows the solver
 * can name, and there is no model connected to any of it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHead,
  DefinitionList,
  Empty,
  EstimateTag,
  Notice,
  PageHead,
  Stat,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
} from '@/components/ui';
import { labelKind } from '@/components/consumer/format';
import { plannableCities } from '@/lib/assistant/catalog';
import {
  INTEREST_VOCABULARY,
  PLANNER_GENERATOR,
  interpretRequestLive,
  istDayStart,
  latestPlan,
  planDay,
  type DayPlan,
  type Interest,
  type ParsedRequest,
} from '@/lib/assistant/planner';
import { currentActor } from '../_queries';
import { addToMyDayAction } from './actions';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Plan my day',
  description: `A deterministic planner over live ${BRAND.name} inventory — it shows what it understood before it shows a plan.`,
};

export const dynamic = 'force-dynamic';

/**
 * Example prompts, written from the cities that are actually live.
 *
 * These used to name Pune and Mumbai in a constant. That was fine while those
 * were the only two cities, and wrong the moment ONEPASS opened a third: a
 * person in Jaipur would be shown three suggestions naming cities they cannot
 * book in, and the planner would answer "no venues" to every one of them. The
 * examples are now generated from `plannableCities()`, so the page teaches the
 * syntax using places the reader can actually use it on.
 */
function examplesFor(cities: { name: string }[]): string[] {
  const first = cities[0]?.name;
  const second = cities[1]?.name ?? first;
  if (!first) {
    // No live city yet. The syntax is still worth showing, without naming a
    // place that would return nothing.
    return [
      'Saturday evening for two, under ₹2,000, food and a film',
      'tonight, just me, dinner',
    ];
  }
  const examples = [
    `Saturday evening in ${first} for two, under ₹2,000, food and a film`,
    `tonight in ${first}, just me, dinner`,
  ];
  if (second && second !== first) {
    examples.push(`this weekend in ${second} for four, budget 6000, food and shopping`);
  }
  return examples;
}

function interestLabel(tag: Interest): string {
  return INTEREST_VOCABULARY.find((d) => d.tag === tag)?.label ?? tag;
}

/**
 * A `YYYY-MM-DD` from the date control, read as an Indian calendar day.
 *
 * The offset is written out rather than left to the runtime's zone: a server in
 * UTC would otherwise turn "12 September" into a window that opens at 05:30 on
 * the 12th and closes at 05:30 on the 13th.
 */
function readDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = new Date(`${value}T00:00:00+05:30`);
  return Number.isFinite(at.getTime()) ? istDayStart(at) : null;
}

/** The `YYYY-MM-DD` an Indian calendar day is written as in a date control. */
function toDateInput(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
}

function InterpretationCard({
  parsed,
  cityName,
  chosenDate,
  plannedPartySize,
}: {
  parsed: ParsedRequest;
  cityName: string | null;
  chosenDate: Date | null;
  plannedPartySize: number;
}) {
  const unstated = <span className="muted">Not stated</span>;

  return (
    <Card>
      <CardHead
        title="What the planner understood"
        action={<Badge tone="info">Read before the plan</Badge>}
      />
      <p className="small muted" style={{ marginTop: -4, marginBottom: 12 }}>
        Every field below is either a value the sentence named or the word “not stated”. Nothing is
        filled in with a likely default, because a default is the one number you would never think
        to check.
      </p>

      <DefinitionList
        items={[
          [
            'City',
            cityName ? (
              cityName
            ) : (
              <span>
                {unstated} — every live {BRAND.name} city was searched
              </span>
            ),
          ],
          [
            'Day',
            parsed.startsAt ? (
              <span>
                {formatDate(parsed.startsAt)}
                <span className="muted"> · read from your sentence</span>
              </span>
            ) : chosenDate ? (
              <span>
                {formatDate(chosenDate)}
                <span className="muted"> · from the date field, not your sentence</span>
              </span>
            ) : (
              <span>{unstated} — the planner will not pick a day for you</span>
            ),
          ],
          [
            'Party size',
            parsed.partySize !== null ? (
              `${parsed.partySize} ${parsed.partySize === 1 ? 'person' : 'people'}`
            ) : (
              <span>
                {unstated} — priced for {plannedPartySize}
              </span>
            ),
          ],
          [
            'Budget',
            parsed.budgetMinor !== null ? (
              formatMoney(parsed.budgetMinor)
            ) : (
              <span>{unstated} — no cap was applied</span>
            ),
          ],
          [
            'Interests',
            parsed.interests.length > 0 ? (
              <span className="row-wrap">
                {parsed.interests.map((tag) => (
                  <Badge key={tag} tone="accent">
                    {interestLabel(tag)}
                  </Badge>
                ))}
              </span>
            ) : (
              <span>{unstated} — the solver ranked on saving and price alone</span>
            ),
          ],
          [
            'Words it did not use',
            parsed.unmatchedTerms.length > 0 ? (
              <span className="row-wrap">
                {parsed.unmatchedTerms.map((term) => (
                  <span key={term} className="badge badge-neutral">
                    {term}
                  </span>
                ))}
              </span>
            ) : (
              <span className="muted">None — every meaningful word matched something</span>
            ),
          ],
        ]}
      />

      {parsed.unmatchedTerms.length > 0 ? (
        <p className="tiny muted" style={{ marginTop: 12 }}>
          Those words had no effect on the plan. The vocabulary is fixed and listed at the bottom of
          this page — a word outside it is ignored rather than guessed at.
        </p>
      ) : null}
    </Card>
  );
}

function PlanItems({
  plan,
  prompt,
  dateValue,
}: {
  plan: DayPlan;
  prompt: string;
  dateValue: string;
}) {
  if (plan.chosen.length === 0) {
    return (
      <Card>
        <Empty
          title="The solver chose nothing"
          body="Nothing in the candidate set fitted the day, the budget and the times together. The binding constraint is stated above."
          action={<ButtonLink href="/deals">See what is live instead</ButtonLink>}
        />
      </Card>
    );
  }

  return (
    <ol className="stack stack-4" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {plan.chosen.map((item, index) => {
        const itemId = plan.itemIds[index];
        return (
          <Card as="li" key={item.key} className="stack stack-3">
            <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div className="grow">
                <p className="eyebrow">{formatDateTime(item.startsAt)}</p>
                <h3 className="h3">{item.venueName}</h3>
                <p className="small muted" style={{ marginTop: 2 }}>
                  {[item.offerTitle ?? item.bandLabel, item.locality].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                <Badge tone="neutral">{labelKind(item.venueKind)}</Badge>
              </div>
            </div>

            <div className="row-wrap">
              <span className="num" style={{ fontSize: 20 }}>
                {formatMoney(item.costMinor)}
              </span>
              {item.savingMinor > 0 ? (
                <Badge tone="ok">Save {formatMoney(item.savingMinor)}</Badge>
              ) : null}
              {item.source === 'TYPICAL_SPEND' ? (
                <EstimateTag>Typical spend, not a price</EstimateTag>
              ) : (
                <Badge tone="info">Live offer</Badge>
              )}
              {item.scheduled ? (
                <Badge tone="accent">Venue’s own slot</Badge>
              ) : (
                <span className="tiny muted">Placed in a default time band</span>
              )}
            </div>

            {/*
              The rationale is printed exactly as the solver produced it. It is
              built from figures in rows — list minus price, the slot's own time,
              the remaining count — so rewording it would break the one link
              between what the screen says and what the data says.
            */}
            <div>
              <p className="eyebrow">Why it is here</p>
              <p className="small">{item.rationale}</p>
            </div>

            {itemId && plan.itineraryId ? (
              <form action={addToMyDayAction} className="row-wrap">
                <input type="hidden" name="itineraryId" value={plan.itineraryId} />
                <input type="hidden" name="itemId" value={itemId} />
                <input type="hidden" name="surface" value="plan" />
                <input type="hidden" name="q" value={prompt} />
                <input type="hidden" name="date" value={dateValue} />
                <Button type="submit" size="sm" variant="primary">
                  Add to my day
                </Button>
                <span className="tiny muted">
                  Holds the capacity for a short window. No money moves — you confirm it under
                  Bookings.
                </span>
              </form>
            ) : (
              <p className="tiny muted">
                This item was not written to an itinerary, so there is nothing to hold against.
              </p>
            )}
          </Card>
        );
      })}
    </ol>
  );
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; date?: string; done?: string; error?: string }>;
}) {
  const actor = await currentActor();
  const params = await searchParams;

  const prompt = params.q?.trim() ?? '';
  const dateValue = params.date?.trim() ?? '';
  const now = new Date();

  const [cities, lastPlan] = await Promise.all([plannableCities(), latestPlan(actor.userId, 'DAY_PLAN')]);
  const examples = examplesFor(cities);

  const parsed = prompt ? await interpretRequestLive(prompt, now) : null;
  const chosenDate = readDateInput(dateValue);
  const startsAt = parsed?.startsAt ?? chosenDate;

  // Everything below is scoped to the signed-in actor: `planDay` writes the
  // itinerary under `actor.userId`, and `acceptPlanItem` reads it back the same
  // way. Nothing on this page takes a user id from the request.
  const plan: DayPlan | null =
    parsed && startsAt
      ? await planDay({
          userId: actor.userId,
          cityId: parsed.cityId,
          budgetMinor: parsed.budgetMinor,
          startsAt,
          interests: parsed.interests,
          partySize: parsed.partySize,
          prompt,
          now,
        })
      : null;

  const cityName = parsed?.cityId ? (cities.find((c) => c.id === parsed.cityId)?.name ?? null) : null;

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Personal commerce"
        title="Plan my day"
        lede={
          <>
            Say what you want in a sentence. {BRAND.name} reads it with a fixed vocabulary, then solves
          for a day out of capacity that is live right now — and shows you both halves of that so
          you can check either one.
          </>
        }
      />

      {params.done ? <Notice tone="ok">{params.done}</Notice> : null}
      {params.error ? (
        <Notice tone="bad">
          <span role="alert">{params.error}</span>
        </Notice>
      ) : null}

      <Card>
        <form method="get" action="/plan" className="stack stack-4">
          <div className="field">
            <label className="label" htmlFor="plan-q">
              What do you want to do?
            </label>
            <textarea
              className="textarea"
              id="plan-q"
              name="q"
              rows={2}
              defaultValue={prompt}
              placeholder={examples[0] ?? "Saturday evening for two, under ₹2,000, food and a film"}
            />
            <p className="hint">
              City, day, party size, budget and interests are read out of this line. Anything it
              cannot read comes back marked “not stated” rather than guessed.
            </p>
          </div>

          <div className="field">
            <label className="label" htmlFor="plan-date">
              Day (only used if your sentence names none)
            </label>
            <input
              className="input"
              id="plan-date"
              name="date"
              type="date"
              defaultValue={dateValue}
              min={toDateInput(now)}
            />
            <p className="hint">
              The planner will not choose a day on your behalf. If the sentence names one, it
              wins and this field is ignored.
            </p>
          </div>

          <div className="row-wrap">
            <Button type="submit" variant="primary">
              Plan it
            </Button>
            {prompt ? (
              <ButtonLink href="/plan" variant="ghost">
                Clear
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </Card>

      {!prompt ? (
        <Card>
          <CardHead title="Try one of these" />
          <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {examples.map((example) => (
              <li key={example}>
                <Link href={`/plan?q=${encodeURIComponent(example)}`}>“{example}”</Link>
              </li>
            ))}
          </ul>
          {lastPlan ? (
            <p className="small muted" style={{ marginTop: 14 }}>
              Your last plan was <strong>{lastPlan.title}</strong>, made {formatRelative(lastPlan.createdAt)} by{' '}
              <span className="mono">{lastPlan.generator}</span>. Planning the same day again
              replaces it rather than stacking up a second draft.
            </p>
          ) : null}
        </Card>
      ) : null}

      {parsed ? (
        <InterpretationCard
          parsed={parsed}
          cityName={cityName}
          chosenDate={chosenDate}
          plannedPartySize={plan?.partySize ?? parsed.partySize ?? 1}
        />
      ) : null}

      {parsed && !startsAt ? (
        <Notice tone="warn">
          <span>
            No day was named, so nothing was planned. Add a day to the sentence — “Saturday”,
            “tonight”, “tomorrow”, “this weekend” — or pick one in the date field above. Choosing
            a day for you would be the planner inventing the one thing the whole plan hangs on.
          </span>
        </Notice>
      ) : null}

      {plan ? (
        <>
          <section className="stat-row" aria-label="What the plan costs">
            <Stat
              label="Planned spend"
              value={formatMoney(plan.totalCostMinor)}
              hint={
                plan.budgetMinor !== null
                  ? `Of a ${formatMoney(plan.budgetMinor)} budget for ${plan.partySize} ${plan.partySize === 1 ? 'person' : 'people'}.`
                  : `For ${plan.partySize} ${plan.partySize === 1 ? 'person' : 'people'}. No budget was named.`
              }
            />
            <Stat
              label="Against list price"
              value={formatMoney(plan.totalSavingMinor)}
              tone={plan.totalSavingMinor > 0 ? 'ok' : 'neutral'}
              hint="List minus price on every item that has a list price. Items priced from typical spend contribute nothing here."
            />
            <Stat
              label="Items chosen"
              value={plan.chosen.length}
              hint={`Out of ${plan.candidatesConsidered} candidate${plan.candidatesConsidered === 1 ? '' : 's'} that fitted the day, ${plan.swapsApplied} improved on a second pass.`}
            />
          </section>

          {!plan.feasible ? (
            <Notice tone="warn">
              <div className="stack stack-2">
                <strong>This is not a complete plan.</strong>
                {plan.binding ? <span>{plan.binding}</span> : null}
                {plan.uncoveredInterests.length > 0 ? (
                  <span>
                    Not covered:{' '}
                    {plan.uncoveredInterests.map((tag) => interestLabel(tag).toLowerCase()).join(', ')}.
                  </span>
                ) : null}
                <span className="small">
                  A shorter list is shown as a shorter list. The solver does not drop an interest
                  quietly and present what is left as if you had asked for it.
                </span>
              </div>
            </Notice>
          ) : (
            <Notice tone="ok">
              Every interest you named is covered, inside the budget and with no two items
              overlapping.
            </Notice>
          )}

          <section>
            <CardHead
              title={plan.title}
              action={
                plan.itineraryRef ? <span className="mono tiny muted">{plan.itineraryRef}</span> : undefined
              }
            />
            <PlanItems plan={plan} prompt={prompt} dateValue={dateValue} />
          </section>
        </>
      ) : null}

      <Card>
        <CardHead title="How this was decided" action={<Badge tone="neutral">No model connected</Badge>} />
        <div className="stack stack-3">
          <p className="small">
            Method: <span className="mono">{PLANNER_GENERATOR}</span>. This is a deterministic
            solver over live inventory — a regular-expression parser for the sentence, then a
            greedy pass over candidate rows ranked on interests covered, then saving, then price,
            with one improvement sweep. It is <strong>not</strong> a large language model, and no
            AI model of any kind is connected to this screen. The same sentence against the same
            rows produces the same plan every time.
          </p>
          <p className="small muted">
            The algorithm version is written to the itinerary row as <span className="mono">generator</span>,
            so a plan that looks wrong can be traced back to the code that produced it. The solver
            approximates a problem that is NP-hard; a better plan may exist, and this one is not
            claimed to be optimal.
          </p>
          <div>
            <p className="eyebrow">The vocabulary it understands</p>
            <ul className="stack stack-2" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
              {INTEREST_VOCABULARY.map((definition) => (
                <li key={definition.tag}>
                  <Badge tone="accent">{definition.label}</Badge>{' '}
                  <span className="tiny muted">{definition.keywords.join(', ')}</span>
                </li>
              ))}
            </ul>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              That list is the whole of it. A word outside it is reported back to you as unused
              rather than matched to something close.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
