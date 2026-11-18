/**
 * City Explorer — the quests.
 *
 * A quest is a list of steps, each asking for a number of distinct venues of one
 * kind. Progress is a record: `quest_progress.progress` maps a step index to the
 * venue ids already credited, and this screen counts those ids. It does not
 * recompute progress from visits, and it does not credit anything itself.
 *
 * The distinction that shapes the whole page: a person with no progress row has
 * no progress, and is told that. Four zeroed counters look like a start somebody
 * has made, and drawing them for a person who has never played would be inventing
 * a history. So the empty state is a sentence, not a set of empty bars.
 *
 * Nothing here claims a reward has been paid. `rewardPoints` is what the quest
 * says it will credit on completion; whether it has been claimed comes from
 * `claimedAt`, which is a column, not an assumption.
 */
import type { Metadata } from 'next';
import {
  Badge,
  ButtonLink,
  Card,
  CardHead,
  Empty,
  Stat,
  formatDate,
  formatRelative,
} from '@/components/ui';
import { labelKind } from '@/components/consumer/format';
import { activeQuests, currentActor, venueNames, type QuestView } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'City Explorer',
  description: 'Quests across the city, and how far you have got.',
};

export const dynamic = 'force-dynamic';

/** Distinct venues credited against one step. */
function creditedFor(quest: QuestView, index: number): string[] {
  return quest.progress?.credited[String(index)] ?? [];
}

function questTone(state: string | undefined): 'ok' | 'warn' | 'neutral' {
  if (state === 'COMPLETED' || state === 'CLAIMED') return 'ok';
  if (state === 'IN_PROGRESS') return 'warn';
  return 'neutral';
}

export default async function QuestsPage() {
  const actor = await currentActor();
  const quests = await activeQuests(actor.userId);

  // One lookup for every credited venue across every quest, so a step can say
  // where it was earned rather than printing an id.
  const names = await venueNames(
    quests.flatMap((q) => q.steps.flatMap((_, i) => creditedFor(q, i))),
  );

  if (quests.length === 0) {
    return (
      <div className="wrap">
        <Card>
          <Empty
            title="No quest is running"
            body="Quests open and close on their own windows, and none is open right now. This is an empty list, not a failed one."
            action={
              <ButtonLink href="/explore" size="sm">
                Explore the city
              </ButtonLink>
            }
          />
        </Card>
      </div>
    );
  }

  // `.wrap` is what every other consumer page is inside, and this one was not —
  // so the quest board rendered edge to edge while its neighbours had gutters.
  // The layout gives vertical rhythm only; the container is each page's own.
  return (
    <div className="wrap stack stack-5">
      <Card>
        <div className="stack stack-3">
          <CardHead level={1} title="City Explorer" />
          <p className="lede">
            Each quest asks you to visit a number of different places of a kind. A visit counts when
            your pass is presented there — nothing on this screen credits itself.
          </p>
        </div>
      </Card>

      {quests.map((quest) => {
        const totalRequired = quest.steps.reduce((sum, s) => sum + s.count, 0);
        const totalDone = quest.steps.reduce(
          (sum, s, i) => sum + Math.min(s.count, creditedFor(quest, i).length),
          0,
        );
        const started = quest.progress !== null;

        return (
          <Card key={quest.id}>
            <div className="stack stack-4">
              <CardHead
                title={quest.name}
                action={
                  <Badge tone={questTone(quest.progress?.state)} dot={started}>
                    {quest.progress
                      ? quest.progress.state.toLowerCase().replace(/_/g, ' ')
                      : 'not started'}
                  </Badge>
                }
              />

              {quest.description ? <p className="muted">{quest.description}</p> : null}

              <div className="stat-row">
                <Stat
                  label="Progress"
                  value={started ? `${totalDone} of ${totalRequired}` : '—'}
                  hint={started ? undefined : 'No visit has been credited to you on this quest.'}
                />
                <Stat
                  label="Reward"
                  value={`${quest.rewardPoints.toLocaleString('en-IN')} points`}
                  hint={
                    quest.progress?.claimedAt
                      ? `Claimed ${formatDate(quest.progress.claimedAt)}`
                      : 'Credited on completion.'
                  }
                />
                {quest.badge ? <Stat label="Badge" value={quest.badge} /> : null}
                {quest.endsAt ? <Stat label="Closes" value={formatDate(quest.endsAt)} /> : null}
              </div>

              <div className="stack stack-3">
                {quest.steps.map((step, index) => {
                  const credited = creditedFor(quest, index);
                  const done = Math.min(step.count, credited.length);
                  const complete = done >= step.count;

                  return (
                    <div key={`${quest.id}-${index}`} className="panel stack stack-2">
                      <div className="row-between">
                        <strong>{step.label}</strong>
                        <Badge tone={complete ? 'ok' : 'neutral'}>
                          {done} of {step.count}
                        </Badge>
                      </div>

                      <span className="tiny muted">
                        {step.count} different {labelKind(step.venueKind).toLowerCase()}
                        {step.count === 1 ? '' : 's'}
                      </span>

                      {credited.length > 0 ? (
                        <span className="tiny muted">
                          Credited:{' '}
                          {credited
                            .map((id) => names.get(id) ?? 'a venue no longer listed')
                            .join(', ')}
                        </span>
                      ) : (
                        <span className="tiny muted">Nothing credited on this step yet.</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {quest.progress ? (
                <p className="tiny muted">
                  Last credited {formatRelative(quest.progress.updatedAt)}
                  {quest.progress.completedAt
                    ? ` · completed ${formatDate(quest.progress.completedAt)}`
                    : ''}
                  {quest.city ? ` · ${quest.city.name}` : ''}
                </p>
              ) : (
                <p className="tiny muted">
                  Present your {BRAND.name} at any of these places and the step is credited then — this
                  screen reads the record, it does not keep its own count.
                </p>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
