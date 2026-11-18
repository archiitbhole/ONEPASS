/**
 * ONEPASS Help.
 *
 * One place for every kind of request, because the alternative — a support
 * route per partner — is what ONEPASS exists to remove. The categories match
 * the things a person actually has: a booking, a payment, a ticket, a stay, a
 * shop, points, a refund.
 *
 * The form warns, in plain words, that ONEPASS never asks for a password or a
 * one-time code. The service also strips anything that looks like one before
 * storing, but the warning is the part that stops it being typed.
 */
import type { Metadata } from 'next';
import {
  Card,
  CardHead,
  Empty,
  Notice,
  PageHead,
  StatusBadge,
  formatRelative,
} from '@/components/ui';
import { currentActor } from '../_queries';
import { listMyTickets, SUPPORT_CATEGORIES } from '@/lib/support/service';
import { SupportForm } from '@/components/consumer/support-form';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Help' };

const CATEGORY_HELP: Record<string, string> = {
  booking: 'A reservation that is wrong, missing or needs changing',
  payment: 'A charge you do not recognise, or one that failed',
  ticket: 'A ticket that will not scan, or is not in your wallet',
  hotel: 'Anything about a stay',
  merchant: 'A problem with a partner, in store or at a venue',
  rewards: 'Points that did not arrive, or would not spend',
  refund: 'A refund you are waiting on',
  account: `Sign-in, devices, or your ${BRAND.name} itself`,
  other: 'Anything else',
};

export default async function HelpPage() {
  const actor = await currentActor();
  const tickets = await listMyTickets(actor.userId);
  const open = tickets.filter((t) => t.status === 'OPEN' || t.status === 'PENDING');

  return (
    <div className="wrap-narrow">
      <div className="stack stack-5">
        <PageHead
          eyebrow="Support"
          title="Help"
          lede={
            <>
              One place for anything across {BRAND.name} — whichever partner it happened at.
            </>
          }
        />

        <Notice tone="warn">
          <span>
            <strong>{BRAND.name} will never ask for your password or a one-time code</strong> — not here,
            not by email, not on the phone. If a message asks for one, it is not from us. Anything
            that looks like a code or a card number is removed before your message is stored.
          </span>
        </Notice>

        {open.length > 0 ? (
          <Card>
            <CardHead title={open.length === 1 ? 'Your open request' : 'Your open requests'} />
            <div className="stack stack-3">
              {open.map((t) => (
                <div key={t.id} className="card-flat">
                  <div className="row-between">
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{t.subject}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="tiny muted" style={{ marginTop: 4 }}>
                    Opened {formatRelative(t.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHead title="Tell us what happened" />
          <SupportForm categories={[...SUPPORT_CATEGORIES]} help={CATEGORY_HELP} />
        </Card>

        <Card>
          <CardHead title="Past requests" />
          {tickets.length === 0 ? (
            <Empty
              title="Nothing yet"
              body="Requests you file will appear here with their status."
            />
          ) : (
            <div className="stack stack-3">
              {tickets.map((t) => (
                <div key={t.id} className="card-flat">
                  <div className="row-between">
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{t.subject}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="tiny muted" style={{ marginTop: 4 }}>
                    {formatRelative(t.createdAt)}
                    {t.resolvedAt ? ` · resolved ${formatRelative(t.resolvedAt)}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
