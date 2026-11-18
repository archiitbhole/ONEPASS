/**
 * Shared with others — every time something about you reached a business or a
 * verifier, on what basis, and which fields (D-006) — and, below it, the record
 * of what you agreed to in the first place.
 *
 * The two belong on one page because they answer one question in two halves:
 * what was seen, and what permitted it. A consent receipt carries the scope's
 * wording as it stood at the moment of the act, not as the definition reads
 * today, since a definition is editable and a record the other party can revise
 * afterwards is not evidence of anything.
 *
 * Server-rendered from the same receipts the API serves. Field names are shown
 * in words ("your email address"); values never, because the receipt never had
 * them. Each row says *why* it was allowed — a consent you granted, or a
 * credential you presented — because a history without its reasons would only
 * tell a person what happened, not whether it should have.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  Empty,
  PageHead,
  formatDateTime,
} from '@/components/ui';
import { listDisclosures, type DisclosureView } from '@/lib/privacy/disclosures';
import { listConsentReceipts } from '@/lib/privacy/consent-receipts';
import { currentActor } from '../_queries';

export const metadata: Metadata = {
  title: 'Shared with others',
  description: 'Who has seen what about you, when, and on what basis.',
};

export const dynamic = 'force-dynamic';

function who(item: DisclosureView): string {
  if (item.recipient.organization) return item.recipient.organization;
  return item.recipient.kind === 'PUBLIC' ? 'Someone who checked it publicly' : 'An organization';
}

function why(item: DisclosureView): string {
  if (item.basis === 'CONSENT') return 'You gave consent';
  return 'You presented a credential';
}

function how(item: DisclosureView): string {
  if (item.channel === 'PARTNER_CONSOLE') return 'Seen by their staff';
  if (item.recipient.kind === 'API_KEY') return 'Checked by their system';
  return 'Checked';
}

function list(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export default async function DisclosuresPage() {
  const actor = await currentActor();
  const [{ items }, consentHistory] = await Promise.all([
    listDisclosures({ userId: actor.userId, limit: 100 }),
    listConsentReceipts({ userId: actor.userId, limit: 50 }),
  ]);

  return (
    <div className="wrap stack stack-6">
      <PageHead
        eyebrow="Privacy"
        title="Shared with others"
        lede={
          <>
            Every time something about you reached a business or a verifier: who, when, which details, and
          why it was allowed. The details themselves are never copied here — only their names.
          </>
        }
      />

      {items.length === 0 ? (
        <Empty
          title="Nothing shared yet"
          body="When a business you are connected to sees your name or contact details, or someone checks a credential you hold, it will appear here."
        />
      ) : (
        <ul className="stack stack-3" aria-label="Disclosures, newest first">
          {items.map((item) => (
            <Card as="li" key={item.reference}>
              <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <h2 className="h3">{who(item)}</h2>
                  <p className="small" style={{ marginTop: 4 }}>
                    {how(item)}: {list(item.fields.map((f) => f.label))}.
                  </p>
                  <p className="tiny muted" style={{ marginTop: 4 }}>
                    {formatDateTime(new Date(item.at))}
                    {item.subject.type === 'credential' ? (
                      <>
                        {' · '}
                        <Link href={`/v/${item.subject.reference}`}>credential {item.subject.reference}</Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <Badge tone={item.basis === 'CONSENT' ? 'info' : 'neutral'}>{why(item)}</Badge>
              </div>
            </Card>
          ))}
        </ul>
      )}

      <section className="stack stack-4" aria-labelledby="consent-history-heading">
        <div className="section-head">
          <h2 id="consent-history-heading">What you agreed to</h2>
        </div>

        {consentHistory.length === 0 ? (
          <Card>
            <Empty
              title="No consent changes recorded"
              body="Agreeing to share something with a business, and withdrawing it again, are both written down here with the wording you saw at the time."
            />
          </Card>
        ) : (
          <ul className="stack stack-3" aria-label="Consent changes, newest first">
            {consentHistory.map((receipt) => (
              <Card as="li" key={receipt.reference}>
                <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <h3 className="h3">
                      {receipt.action === 'GRANTED' ? 'You shared' : 'You stopped sharing'} &ldquo;
                      {receipt.scope.label}&rdquo;
                    </h3>
                    <p className="small" style={{ marginTop: 4 }}>
                      {receipt.organizationName ?? 'A business'}
                      {receipt.scope.fields.length > 0 ? ` · ${list(receipt.scope.fields)}` : ''}
                    </p>
                    {receipt.purpose ? (
                      <p className="tiny muted" style={{ marginTop: 4 }}>
                        {receipt.purpose}
                      </p>
                    ) : null}
                    <p className="tiny muted" style={{ marginTop: 4 }}>
                      {formatDateTime(receipt.at)}
                      {receipt.versionNumber !== null ? ` · version ${receipt.versionNumber}` : ''}
                      {' · '}
                      <span className="mono">{receipt.reference}</span>
                    </p>
                  </div>
                  <div className="stack stack-1" style={{ alignItems: 'flex-end' }}>
                    <Badge tone={receipt.action === 'GRANTED' ? 'ok' : 'neutral'}>
                      {receipt.action === 'GRANTED' ? 'Agreed' : 'Withdrawn'}
                    </Badge>
                    {receipt.scope.sensitive ? <Badge tone="warn">Sensitive</Badge> : null}
                  </div>
                </div>
              </Card>
            ))}
          </ul>
        )}

        <p className="small muted measure">
          Each line is the wording that was in front of you when you agreed, kept as it was — not as the
          business describes that permission today. Quote the reference if you ever need to.
        </p>
      </section>

      <p className="small muted">
        To stop a business seeing something, withdraw the consent on your{' '}
        <Link href="/profile">profile</Link>; it applies from their next look.
      </p>
    </div>
  );
}
