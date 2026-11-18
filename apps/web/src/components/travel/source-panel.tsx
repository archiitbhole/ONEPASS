/**
 * Every source, accounted for.
 *
 * The rule this component exists to hold: a search reports what each source
 * did, including the ones that failed and the ones that were never asked.
 * "Nothing cheap on this route" and "one of our two sources was down" look
 * identical from outside, and only one of them is a reason to search again in a
 * minute.
 *
 * So the list is built from the *catalogue*, not from the outcomes. A provider
 * that did not answer cannot fall off the bottom of this list, because it was
 * never on a list built from what answered.
 *
 * Four things a source can be, and each gets its own line:
 *
 *  · answered, with how many fares and how long it took;
 *  · asked and failed, with the provider's own reason in plain words;
 *  · connected but rested — the circuit breaker is holding it back after four
 *    consecutive failures, which is this deployment's decision, not the
 *    supplier's;
 *  · not connected, with the environment variables an operator has to set.
 */
import { Badge } from '@/components/ui';
import type { ProviderOutcome } from '@/lib/travel/search';
import type { SourceSummary } from './sources';

/** A duration a person can read. Under a second, milliseconds; over, seconds. */
function elapsed(ms: number): string {
  return ms < 1_000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function SourcePanel({
  summary,
  outcomes,
  /** True when this page is a persisted search re-rendered without asking anybody. */
  replayed = false,
}: {
  summary: SourceSummary;
  outcomes: ProviderOutcome[];
  replayed?: boolean;
}) {
  const byId = new Map(outcomes.map((outcome) => [outcome.source, outcome]));

  return (
    <ul className="op-sources" aria-label="What each flight source returned">
      {summary.all.map((provider) => {
        const outcome = byId.get(provider.id);
        const tone = !provider.configured
          ? 'op-source-off'
          : outcome
            ? outcome.ok
              ? 'op-source-ok'
              : 'op-source-bad'
            : 'op-source-off';

        return (
          <li key={provider.id} className={`op-source ${tone}`}>
            <span className="op-source-dot" aria-hidden="true" />
            <span className="grow">
              <span className="op-source-name">
                {provider.label}
                {provider.kind === 'sample' ? ' — development fixtures' : ''}
              </span>
              <span className="op-source-said" style={{ display: 'block' }}>
                {!provider.configured ? (
                  <>
                    Not connected, so it was not asked. Needs{' '}
                    <code className="tiny">{provider.requires.join(', ')}</code>.
                  </>
                ) : outcome ? (
                  outcome.ok ? (
                    `Answered with ${outcome.offerCount} fare${outcome.offerCount === 1 ? '' : 's'} in ${elapsed(outcome.elapsedMs)}.`
                  ) : (
                    (outcome.message ?? 'Did not answer.')
                  )
                ) : replayed ? (
                  'Not asked — these results were saved from an earlier search.'
                ) : (
                  'Connected, but rested after repeated failures. It is asked again shortly.'
                )}
              </span>
            </span>
            <span className="op-source-req">
              {!provider.configured ? (
                <Badge tone="neutral">Not connected</Badge>
              ) : outcome?.ok ? (
                <Badge tone="ok">Answered</Badge>
              ) : outcome ? (
                <Badge tone="warn">No answer</Badge>
              ) : replayed ? (
                <Badge tone="neutral">Not asked</Badge>
              ) : (
                <Badge tone="warn">Resting</Badge>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
