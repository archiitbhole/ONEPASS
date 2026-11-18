/**
 * Where a return case has got to, and where it may go next.
 *
 * The spine below is the ordinary path through `RETURN_TRANSITIONS`; the map in
 * src/lib/commerce/returns.ts remains the specification, and this component
 * reads the allowed next states from it rather than restating them. A case that
 * ended off the spine — rejected, or withdrawn by the consumer — is drawn as a
 * stop rather than as a step, because it is one.
 */
import { RETURN_TRANSITIONS, type ReturnState } from '@/lib/commerce/returns';

interface Stage {
  label: string;
  states: ReturnState[];
}

/** The ordinary path. Two states share a stage where they are the same moment. */
const SPINE: Stage[] = [
  { label: 'Requested', states: ['REQUESTED'] },
  { label: 'Under review', states: ['UNDER_REVIEW'] },
  { label: 'Decided', states: ['APPROVED', 'REJECTED'] },
  { label: 'Goods returning', states: ['IN_TRANSIT'] },
  { label: 'Settled', states: ['REFUNDED', 'REPLACED'] },
  { label: 'Closed', states: ['CLOSED'] },
];

/** -1 for a state that never joins the spine. */
function stageOf(state: ReturnState): number {
  return SPINE.findIndex((stage) => stage.states.includes(state));
}

export function nextStatesFor(state: ReturnState): ReturnState[] {
  return RETURN_TRANSITIONS[state];
}

export function ReturnStepper({ state }: { state: ReturnState }) {
  const current = stageOf(state);
  const stopped = state === 'REJECTED' || state === 'CANCELLED';
  const next = nextStatesFor(state);

  return (
    <div className="stack stack-2">
      <ol
        className="row-wrap"
        style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}
        aria-label={`Return state: ${state.replace(/_/g, ' ').toLowerCase()}`}
      >
        {SPINE.map((stage, i) => {
          const done = current >= 0 && i < current;
          const here = i === current;
          const tone = here ? (stopped ? 'bad' : 'accent') : done ? 'ok' : 'neutral';

          return (
            <li key={stage.label} className="row" style={{ gap: 6 }}>
              <span className={`badge badge-${tone}`} aria-current={here ? 'step' : undefined}>
                {here ? state.replace(/_/g, ' ').toLowerCase() : stage.label}
              </span>
              {i < SPINE.length - 1 ? (
                <span aria-hidden="true" className="tiny muted">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="tiny muted">
        {state === 'CANCELLED'
          ? 'Withdrawn by the customer before anyone picked it up. Nothing further is possible on this case.'
          : next.length === 0
            ? 'This case is finished. No further move is allowed on it.'
            : `Allowed next: ${next.map((s) => s.replace(/_/g, ' ').toLowerCase()).join(', ')}.`}
      </p>
    </div>
  );
}
