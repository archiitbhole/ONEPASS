/**
 * Home — the command centre.
 *
 * Not a grid of equal cards. The order is the order of a day: the pass, because
 * that is what someone opens the app holding a phone at a counter for; then the
 * next thing they are booked into; then anything that needs them before it
 * lapses; then what the month has been worth; then what is live right now.
 *
 * On a desktop the pass and "next up" sit side by side, because both are
 * glanceable and neither deserves a scroll. On a phone the pass is first and
 * full width — it is the object, and the object leads.
 *
 * Every figure is a query. There are no placeholder rows anywhere below: a
 * section with nothing in it says so and offers the next real step. An account
 * with nothing in it yet gets first steps instead of five empty sections, and
 * each step is ticked from real data rather than from stored progress.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ButtonLink,
  Card,
  Empty,
  Money,
  Stat,
  formatDate,
  formatDateTime,
  formatRelative,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { Pass, Ticket } from '@/components/objects';
import { ObjectLight } from '@/components/system/object-light';
import { TransitionLink } from '@/components/system/view-transitions';
import { DealCard } from '@/components/consumer/deal-card';
import { QuickActions } from '@/components/consumer/quick-actions';
import {
  ticketBandLabel,
  ticketKindFor,
  ticketStampWord,
  ticketStateOf,
  ticketWhere,
} from '@/components/consumer/ticket-shape';
import { listLiveDeals } from '@/lib/commerce/offers';
import { listTickets } from '@/lib/commerce/tickets';
import { listWarranties } from '@/lib/commerce/warranties';
import { listReturns } from '@/lib/commerce/returns';
import { walletSummary } from '@/lib/commerce/rewards';
import { mintPassToken } from '@/lib/pass/service';
import { currentActor, profileSnapshot, recentActivity, savingsThisMonth } from '../_queries';
import { BRAND } from '@/lib/brand';
import { safeLinkPath } from '@/components/consumer/notification-shape';

export const metadata: Metadata = {
  title: `Your ${BRAND.name}`,
  description: 'Your pass, your next ticket, and what you have saved this month.',
};

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(now),
  );
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function HomePage() {
  const actor = await currentActor();
  const now = new Date();

  // The pass card only needs to know a pass exists. `mintPassToken` throws when
  // it does not, and that is the honest signal — there is no "probably fine".
  const pass = await mintPassToken(actor.userId).then(
    (p) => ({ ok: true as const, passRef: p.passRef }),
    () => ({ ok: false as const, passRef: null }),
  );

  const [upcoming, savedThisMonth, wallet, deals, activity, expiring, returns, snapshot] = await Promise.all([
    listTickets({ userId: actor.userId, upcoming: true, limit: 1 }),
    savingsThisMonth(actor.userId, now),
    walletSummary(actor.userId),
    listLiveDeals({ limit: 3, now }),
    recentActivity(actor.userId, 5),
    listWarranties({ userId: actor.userId, status: 'EXPIRING', limit: 3, now }),
    listReturns({ userId: actor.userId, limit: 5 }),
    profileSnapshot(actor.userId),
  ]);

  const nextTicket = upcoming[0];
  const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' }).format(now);
  const openReturns = returns.filter((r) =>
    ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'IN_TRANSIT'].includes(r.request.state),
  );

  // "New here" is a fact about the account, not a flag: nothing booked, nothing
  // bought, nobody connected.
  const isNew =
    !nextTicket && returns.length === 0 && expiring.length === 0 && snapshot.connections.length === 0 && wallet.totalPoints === 0;

  const firstSteps = [
    {
      done: pass.ok,
      title: 'Your pass is ready',
      body: 'One code at every counter. It changes every thirty seconds, so a photograph of it is useless a minute later.',
      href: '/pass',
      action: 'Open your pass',
    },
    {
      done: snapshot.consents.length > 0,
      title: 'Decide what businesses may see',
      body: 'Nothing is shared until you grant it, and you can withdraw a consent at any time.',
      href: '/profile',
      action: 'Review sharing',
    },
    {
      done: false,
      title: 'Find something tonight',
      body: 'Live deals are short windows published by partners near you.',
      href: '/explore',
      action: 'Explore',
    },
    {
      done: snapshot.preferences.length > 0,
      title: 'Make it yours',
      body: 'Appearance, what we notify you about, and the details on your account.',
      href: '/settings',
      action: 'Open settings',
    },
  ];

  return (
    <div className="wrap stack stack-6">
      <header className="home-head">
        <p className="eyebrow">
          {greeting(now)}, {actor.displayName.split(' ')[0]}
        </p>
        <h1 className="display h1">Your {BRAND.name}</h1>
      </header>

      <div className="home-lead">
        {/* The whole card is the link to /pass, and it carries the transition
            name the opened pass also carries — so it travels rather than
            blinking. */}
        <section aria-label="Your pass" className="home-pass">
          {pass.ok ? (
            <ObjectLight>
              <Pass
                seed={pass.passRef}
                href="/pass"
                transitionName="pass"
                label={`Your ${BRAND.name} pass — open it`}
              >
                <Pass.Top status="Active" />
                <Pass.Chip />
                <Pass.Holder name={actor.displayName} reference={pass.passRef} meta="Holder" />
              </Pass>
            </ObjectLight>
          ) : (
            <Card>
              <Empty
                title="No active pass on this account"
                body="A pass is issued when an account is verified. Until then nothing at a counter will recognise you."
                action={<ButtonLink href="/settings">Check your account</ButtonLink>}
              />
            </Card>
          )}
          <p className="small muted home-pass-hint">
            <Glyph name="scan" size={16} /> Hold the code to the reader. It rotates every thirty seconds.
          </p>
        </section>

        <section aria-labelledby="now-heading" className="home-now stack stack-4">
          <div className="section-head">
            <h2 id="now-heading">{isNew ? 'First steps' : 'Next up'}</h2>
            {isNew ? null : (
              <TransitionLink className="small" href="/tickets">
                All tickets
              </TransitionLink>
            )}
          </div>

          {isNew ? (
            <ol className="first-steps">
              {firstSteps.map((step, i) => (
                <li key={step.title} data-done={step.done ? 'true' : undefined}>
                  <span className="first-steps-mark" aria-hidden="true">
                    {step.done ? <Glyph name="check" size={16} /> : i + 1}
                  </span>
                  <span className="stack stack-1">
                    <span className="h4">
                      {step.title}
                      {step.done ? <span className="sr-only"> — done</span> : null}
                    </span>
                    <span className="small muted">{step.body}</span>
                    <Link className="small" href={step.href}>
                      {step.action} →
                    </Link>
                  </span>
                </li>
              ))}
            </ol>
          ) : nextTicket ? (
            <>
              <Ticket
                kind={ticketKindFor(nextTicket.venue?.kind)}
                state={ticketStateOf(nextTicket.ticket.state)}
                href={`/tickets/${nextTicket.ticket.publicRef}`}
                transitionName={`ticket-${nextTicket.ticket.publicRef}`}
                label={`${nextTicket.ticket.title} — open ticket`}
              >
                <Ticket.Main>
                  <Ticket.Band
                    label={ticketBandLabel(nextTicket.venue?.kind)}
                    right={nextTicket.ticket.seatLabel ?? undefined}
                  />
                  <Ticket.Title level={3}>{nextTicket.ticket.title}</Ticket.Title>
                  <Ticket.Fields
                    items={[
                      { label: 'When', value: formatDateTime(nextTicket.ticket.validFrom) },
                      { label: 'Starts', value: formatRelative(nextTicket.ticket.validFrom) },
                      ...(ticketWhere(nextTicket.ticket.title, nextTicket.venue)
                        ? [{ label: 'Where', value: ticketWhere(nextTicket.ticket.title, nextTicket.venue)! }]
                        : []),
                    ]}
                  />
                </Ticket.Main>
                <Ticket.Stub>
                  <Ticket.Stamp tone={ticketStampWord(nextTicket.ticket.state).tone}>
                    {ticketStampWord(nextTicket.ticket.state).word}
                  </Ticket.Stamp>
                  <span className="ticket-label">Open to show</span>
                </Ticket.Stub>
              </Ticket>

              {(openReturns.length > 0 || expiring.length > 0) && (
                <Card className="stack stack-3">
                  <h3 className="eyebrow plain">Wants you</h3>
                  <ul className="ledger">
                    {openReturns.slice(0, 2).map((r) => (
                      <li key={r.request.id}>
                        <span className="ledger-main">
                          <Link className="ledger-title" href="/returns">
                            {r.line?.description ?? 'Return'} · {r.request.state.replace(/_/g, ' ').toLowerCase()}
                          </Link>
                          <span className="ledger-meta">
                            {r.organization?.name ?? 'Partner'} · opened {formatRelative(r.request.createdAt)}
                          </span>
                        </span>
                      </li>
                    ))}
                    {expiring.slice(0, 2).map((w) => (
                      <li key={w.warranty.id}>
                        <span className="ledger-main">
                          <Link className="ledger-title" href={`/warranties/${w.warranty.publicRef}`}>
                            {w.warranty.productName} — cover ends {formatDate(w.warranty.expiresOn)}
                          </Link>
                          <span className="ledger-meta">{w.organization?.name ?? 'Partner'}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <Empty
                title="Nothing booked yet"
                body={`Tickets you book through ${BRAND.name} appear here with the code you show at the door.`}
                action={
                  <ButtonLink href="/deals" variant="primary">
                    See live deals
                  </ButtonLink>
                }
              />
            </Card>
          )}
        </section>
      </div>

      <section className="stat-row" aria-label="Your month">
        <Stat
          label={`Saved in ${monthLabel}`}
          value={<Money minor={savedThisMonth} />}
          tone="value"
          hint={
            savedThisMonth > 0 ? (
              <Link href="/savings">See where it came from</Link>
            ) : (
              'Savings appear here the moment a discounted booking is confirmed.'
            )
          }
        />
        <Stat
          label="Points balance"
          value={wallet.totalPoints.toLocaleString('en-IN')}
          hint={
            wallet.totalPoints > 0 ? (
              <>
                Worth about <Money minor={wallet.totalValueMinor} /> at the platform rate ·{' '}
                <Link href="/wallet">Wallet</Link>
              </>
            ) : (
              'Points are credited when a purchase is captured.'
            )
          }
        />
        <Stat
          label="Reward accounts"
          value={wallet.accounts.length}
          tone="neutral"
          hint={
            wallet.accounts.length > 0
              ? 'One per issuing partner, plus the network account.'
              : 'No partner has issued you points yet.'
          }
        />
      </section>

      <section aria-labelledby="live-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="live-heading">Live now</h2>
          <Link className="small" href="/deals">
            All deals
          </Link>
        </div>
        {deals.length > 0 ? (
          <ul className="grid grid-2 stagger">
            {deals.map((deal) => (
              <DealCard key={deal.publicRef} deal={deal} />
            ))}
          </ul>
        ) : (
          <Card>
            <Empty
              title="No deals are running right now"
              body="Live deals are short windows published by partners. Explore venues in the meantime."
              action={<ButtonLink href="/explore">Explore venues</ButtonLink>}
            />
          </Card>
        )}
      </section>

      <section aria-labelledby="more-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="more-heading">More in {BRAND.name}</h2>
        </div>
        <QuickActions />
      </section>

      <section aria-labelledby="activity-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="activity-heading">Recent activity</h2>
          <Link className="small" href="/notifications">
            All notifications
          </Link>
        </div>
        {activity.length > 0 ? (
          <Card>
            <ul className="ledger">
              {activity.map((item) => {
                // Through `safeLinkPath`, like the inbox: `link_path` is a
                // column written by whichever service caused the notification,
                // and some of those rows point at screens that have since been
                // renamed. Rendering it raw put a 404 on the home page.
                const href = safeLinkPath(item.linkPath);
                return (
                <li key={item.id}>
                  <span className={item.readAt ? 'dot' : 'dot dot-live'} aria-hidden="true" style={{ marginTop: 7 }} />
                  <span className="ledger-main">
                    <span className="row-between" style={{ gap: 10 }}>
                      <strong className="small">
                        {href ? <Link href={href}>{item.title}</Link> : item.title}
                      </strong>
                      <span className="tiny muted nowrap">{formatRelative(item.createdAt)}</span>
                    </span>
                    <span className="small muted">{item.body}</span>
                  </span>
                </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <Card>
            <Empty
              title="Nothing has happened yet"
              body="Confirmations, receipts and warranty reminders land here as they happen."
            />
          </Card>
        )}
      </section>
    </div>
  );
}
