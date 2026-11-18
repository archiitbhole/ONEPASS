/**
 * What this deployment can honestly say about its flight sources.
 *
 * Three surfaces used to answer this question for themselves — the hub, the
 * search page and the results page — by counting `knownProviders()` in three
 * slightly different ways. The one that mattered was the case nobody had
 * written down: a deployment with *only* the sample source connected is not
 * "connected". It can run the whole flow end to end and not one of the fares it
 * shows can be flown, and a screen that says "1 source connected" about that is
 * technically true and wholly misleading.
 *
 * So the question is answered once, as a named state, and every travel screen
 * renders from it.
 *
 * Nothing here reads a credential's value — only `knownProviders()`, which has
 * already reduced each one to a boolean.
 */
import { knownProviders, type ProviderDescriptor } from '@/lib/travel/providers/registry';

export type SourceState =
  /** At least one licensed provider holds its credentials. Fares are real. */
  | 'LIVE'
  /** Only the development fixture source. Everything works; nothing can be flown. */
  | 'SAMPLE_ONLY'
  /** Nothing is connected. A search would return nothing, so none is offered. */
  | 'NONE';

export interface SourceSummary {
  state: SourceState;
  /** Every provider this build knows how to talk to, configured or not. */
  all: ProviderDescriptor[];
  /** Licensed providers holding credentials. Never includes the sample source. */
  live: ProviderDescriptor[];
  /** Licensed providers still waiting for credentials. */
  waiting: ProviderDescriptor[];
  /** True when the sample source is one of the things answering. */
  sampleConnected: boolean;
  /** One sentence, in the product's voice, about what the above means. */
  headline: string;
  /** The longer form, for a notice. */
  detail: string;
}

export function sourceSummary(): SourceSummary {
  const all = knownProviders();
  const live = all.filter((provider) => provider.configured && provider.kind !== 'sample');
  const waiting = all.filter((provider) => !provider.configured && provider.kind !== 'sample');
  const sampleConnected = all.some((provider) => provider.configured && provider.kind === 'sample');

  if (live.length > 0) {
    return {
      state: 'LIVE',
      all,
      live,
      waiting,
      sampleConnected,
      headline: `${live.map((provider) => provider.label).join(' and ')} ${live.length === 1 ? 'is' : 'are'} connected.`,
      detail:
        'Every fare below is quoted by a licensed provider and is booked with that provider, under its terms. Each source is accounted for on the results, including any that did not answer.',
    };
  }

  if (sampleConnected) {
    return {
      state: 'SAMPLE_ONLY',
      all,
      live,
      waiting,
      sampleConnected,
      headline: 'No airline source is connected. Only the development sample source is answering.',
      detail:
        'Nothing this deployment returns is an airline’s fare, and nothing can be flown. The sample source exists so the search, pricing and booking flow can be exercised without a provider account; the production guard refuses to start with it enabled.',
    };
  }

  return {
    state: 'NONE',
    all,
    live,
    waiting,
    sampleConnected,
    headline: 'No flight source is connected to this deployment.',
    detail:
      'A flight source is an account with a licensed provider. The adapters are written and covered by unit tests; each one needs its own credentials before a fare can be quoted, and nothing here will show a price it cannot sell.',
  };
}

/** True when a search would reach at least one source. */
export function canSearch(summary: SourceSummary): boolean {
  return summary.state !== 'NONE';
}

/** True when a fare from this source is a real airline's fare. */
export function isRealFare(source: string): boolean {
  return source !== 'SAMPLE';
}
