/**
 * The flight search form, on its own page.
 *
 * `/travel` already carries a search box, so this page exists for the two cases
 * that one does not serve: arriving at a bookmarked search page directly, and
 * coming back from a results page to change something. Both want the form at
 * full size with nothing else competing for attention.
 *
 * It also carries the note about where fares come from. That note belongs
 * somewhere a person looking closely will find it, and this is the page they are
 * on when they start looking closely — so the provider list here is the full
 * one, connected and not, with the credentials each missing source needs.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, Notice, Stack } from '@/components/ui';
import { Guilloche } from '@/components/objects';
import { FeatureNote, StatusChip } from '@/components/system';
import { SearchForm, defaultSearchValues } from '@/components/travel/search-form';
import { SourcePanel } from '@/components/travel/source-panel';
import { sourceSummary } from '@/components/travel/sources';
import { listAirports } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Search flights',
  description: 'Search every connected flight source at once and compare what each one found.',
};

export const dynamic = 'force-dynamic';

export default async function FlightSearchPage() {
  const airports = await listAirports();
  const sources = sourceSummary();

  return (
    <div className="wrap stack stack-6">
      <section className="immersive travel-stage" aria-labelledby="search-heading">
        <Guilloche pattern="field" />
        <div className="travel-stage-grid">
          <div className="travel-stage-say">
            <p className="eyebrow">
              <Link href="/travel">Travel</Link> · Flights
            </p>
            <h1 className="display h1" id="search-heading">
              Search flights
            </h1>
            <p className="lede">
              Every connected source is asked at once, and you are told what each one returned — including
              the ones that did not answer. Partial results are results; a missing source is stated, never
              filled in from somewhere else.
            </p>
            <p className="travel-stage-note">
              <StatusChip featureKey="flights" />
              <span className="small">{sources.headline}</span>
            </p>
          </div>

          <div className="travel-stage-form">
            {sources.state === 'NONE' ? (
              <Stack gap={4}>
                <h2 className="h3">Nothing to search</h2>
                <p className="small">{sources.detail}</p>
                <SourcePanel summary={sources} outcomes={[]} />
              </Stack>
            ) : (
              <Stack gap={4}>
                <h2 className="h3">Where to?</h2>
                <SearchForm airports={airports} values={defaultSearchValues()} />
              </Stack>
            )}
          </div>
        </div>
      </section>

      {sources.state === 'SAMPLE_ONLY' ? (
        <Notice tone="warn">
          <strong>Sample fares only.</strong> {sources.detail}
        </Notice>
      ) : null}

      <section aria-labelledby="sources-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="sources-heading">Where these fares come from</h2>
        </div>
        <Card>
          <Stack gap={4}>
            <p className="small">
              {BRAND.name} holds no seats of its own. Every fare is quoted by a licensed provider and is
              booked with that provider, under its terms. Nothing here scrapes an airline’s website, works
              around a CAPTCHA or resells inventory it is not entitled to — those are not shortcuts, they
              are the difference between a business and a liability.
            </p>
            <SourcePanel summary={sources} outcomes={[]} />
            <FeatureNote featureKey="flights" />
            <p className="tiny muted">
              Both real adapters are written against their published specifications and covered by unit
              tests over recorded response shapes. Neither has been exercised against a live account in
              this build, because this repository holds no credentials for either — which is why they are
              reported as needing setup rather than as working.
            </p>
          </Stack>
        </Card>
      </section>
    </div>
  );
}
