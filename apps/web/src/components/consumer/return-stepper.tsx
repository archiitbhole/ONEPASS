/**
 * Where a return case sits in its state machine, drawn.
 *
 * The route is derived from `RETURN_TRANSITIONS` itself — a breadth-first search
 * from REQUESTED to the case's current state — rather than from a hand-drawn
 * picture of the happy path. That matters because the map is the specification: if
 * someone adds a state tomorrow, this stepper follows, and it can never show a step
 * the service would refuse.
 *
 * What it is NOT: a history. Nothing records the exact sequence a case took, so
 * this shows the shortest route the machine allows to where the case is now, and
 * says so. Drawing an invented past would be worse than drawing none.
 */
import { RETURN_TRANSITIONS, type ReturnState } from '@/lib/commerce/returns';

const START: ReturnState = 'REQUESTED';

/** Final states, read off the map rather than listed by hand. */
function isFinal(state: ReturnState): boolean {
  return RETURN_TRANSITIONS[state].length === 0;
}

/**
 * The shortest legal route from REQUESTED to `to`.
 *
 * Breadth-first, so "shortest" is a fact about the graph. A state unreachable from
 * REQUESTED — which the current map has none of — degrades to just that state
 * rather than to a fabricated path.
 */
export function routeTo(to: ReturnState): ReturnState[] {
  if (to === START) return [START];

  const queue: ReturnState[][] = [[START]];
  const seen = new Set<ReturnState>([START]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const tail = path[path.length - 1]!;
    for (const next of RETURN_TRANSITIONS[tail]) {
      if (next === to) return [...path, next];
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }

  return [to];
}

function label(state: ReturnState): string {
  return state.replace(/_/g, ' ').toLowerCase();
}

export function ReturnStepper({ state }: { state: ReturnState }) {
  const path = routeTo(state);
  const next = RETURN_TRANSITIONS[state];

  return (
    <div className="stack stack-2">
      <ol className="op-stepper" aria-label={`Return progress — currently ${label(state)}`}>
        {path.map((step, i) => {
          const current = i === path.length - 1;
          return (
            <li key={`done-${step}`}>
              <span
                className="op-step"
                data-done={!current ? 'true' : undefined}
                data-current={current ? 'true' : undefined}
                aria-current={current ? 'step' : undefined}
              >
                <span className="op-step-mark" aria-hidden="true">
                  {current ? '●' : '✓'}
                </span>
                {label(step)}
              </span>
            </li>
          );
        })}

        {next.map((step) => (
          <li key={`next-${step}`}>
            <span className="op-step op-step-next">{label(step)}</span>
          </li>
        ))}
      </ol>

      <p className="tiny muted">
        {isFinal(state)
          ? `${label(state).charAt(0).toUpperCase()}${label(state).slice(1)} is a final state — the case cannot move again.`
          : `From ${label(state)} the service will accept ${next.map(label).join(' or ')}. Dashed steps have not happened.`}
      </p>
    </div>
  );
}
