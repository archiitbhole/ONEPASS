/**
 * Settings — the parts of an account a person changes, in one place.
 *
 * `/profile` is the account *hub*: who you are, which businesses hold a handle
 * for you, what is signed in, what has been seen. This is the workshop next to
 * it: the four things that are edits rather than records — your details, how the
 * app looks, what you are told about, and what happens to all of it.
 *
 * The rule the whole screen is built on is the one `/profile` already followed:
 * a control exists only where an endpoint does. Every control here was checked
 * against the route behind it, and where an endpoint stops short of what a
 * person would assume, the sentence beside the button says where it stops —
 * `POST /api/me/export` records a request and writes no archive; `DELETE
 * /api/me/account` files a closure and deletes nothing; a notification
 * preference is stored and nothing reads it yet. None of those is a reason to
 * hide the control. All of them are reasons to say so.
 *
 * Server component throughout. The four islands that need the browser —
 * appearance, the profile form, the switches, the two elevated actions — carry
 * their own `'use client'` and their own reason for it.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import {
  Badge,
  Card,
  DefinitionList,
  Notice,
  PageHead,
  formatDate,
} from '@/components/ui';
import { Glyph } from '@/components/icons';
import { FeatureNote, StatusChip } from '@/components/system';
import { ThemeToggle } from '@/components/system/theme-toggle';
import { THEME_COOKIE, parseTheme } from '@/components/system/theme';
import { SettingsIdentity } from '@/components/consumer/settings-identity';
import { SettingsNotifications, type PreferenceRow } from '@/components/consumer/settings-notifications';
import { SettingsData } from '@/components/consumer/settings-data';
import type { notificationCategory } from '@/db/schema';
import { currentActor, profileSnapshot } from '../_queries';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Settings',
  description: `Your details, how ${BRAND.name} looks, what you are told about, and what happens to your data.`,
};

export const dynamic = 'force-dynamic';

/** Matches GRACE_DAYS in `api/me/account`. Shown, never used to decide anything. */
const GRACE_DAYS = 30;

/**
 * The categories, in the order somebody would care about them.
 *
 * Every one of these is a member of the `notification_category` enum, so the
 * endpoint accepts all of them; registration writes rows for the first five and
 * the sixth is created the moment somebody chooses anything about it.
 */
type Category = (typeof notificationCategory.enumValues)[number];

const CATEGORIES: { category: Category; label: string; description: string }[] = [
  {
    category: 'SECURITY',
    label: 'Security',
    description: 'A sign-in you did not expect, a device signed out, your pass reissued, your account locked.',
  },
  {
    category: 'TRANSACTION',
    label: 'Money',
    description: 'Payments, receipts, refunds, and a share of a split being paid or declined.',
  },
  {
    category: 'CONSENT',
    label: 'Sharing',
    description: 'When you grant or withdraw what a business may read about you.',
  },
  {
    category: 'PARTNER',
    label: 'Businesses',
    description: 'A booking confirming, an offer you hold, a return moving at a partner.',
  },
  {
    category: 'ACCOUNT',
    label: 'Your account',
    description: 'Verification, a copy of your data, a closure request.',
  },
  {
    category: 'PRODUCT',
    label: 'Things you own',
    description: 'A warranty running out, a transfer offered or claimed.',
  },
];

export default async function SettingsPage() {
  const actor = await currentActor();
  const [snapshot, jar] = await Promise.all([profileSnapshot(actor.userId), cookies()]);
  const { account, profile, preferences, sessions, connections, consents } = snapshot;

  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);

  // The stored row wins where there is one; a category registration never wrote
  // is shown as on, which is what having no row means today.
  const stored = new Map(preferences.filter((p) => p.channel === 'IN_APP').map((p) => [p.category, p.enabled]));
  const preferenceRows: PreferenceRow[] = CATEGORIES.map((c) => ({
    category: c.category,
    channel: 'IN_APP',
    label: c.label,
    description: c.description,
    enabled: c.category === 'SECURITY' ? true : (stored.get(c.category) ?? true),
    locked: c.category === 'SECURITY',
  }));

  const liveConsents = consents.filter((c) => c.state === 'GRANTED').length;
  const activeConnections = connections.filter((c) => c.state === 'ACTIVE').length;

  return (
    <div className="wrap-narrow stack stack-6">
      <PageHead
        eyebrow="Your account"
        title="Settings"
        lede={`What you can change about your ${BRAND.name}. Everything that is a record rather than a choice lives on your profile.`}
        actions={
          <Link className="small" href="/profile">
            Your profile →
          </Link>
        }
      />

      {/* ── you ── */}
      <section aria-labelledby="you-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="you-heading">You</h2>
          <StatusChip featureKey="profile-edit" />
        </div>

        <Card>
          <SettingsIdentity
            initial={{
              displayName: profile?.displayName ?? actor.displayName,
              city: profile?.city ?? '',
            }}
          />
        </Card>

        <Card className="card-sunken">
          <div className="stack stack-3">
            <h3 className="h4">Not editable here</h3>
            <DefinitionList
              items={[
                [
                  'Email',
                  account?.email ? (
                    <span key="e" className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                      <span className="break-all">{account.email}</span>
                      {account.emailVerified ? <Badge tone="ok">verified</Badge> : <Badge tone="warn">unverified</Badge>}
                    </span>
                  ) : (
                    'Not on this account'
                  ),
                ],
                [
                  'Mobile',
                  account?.mobile ? (
                    <span key="m" className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                      <span className="mono">{account.mobile}</span>
                      {account.mobileVerified ? (
                        <Badge tone="ok">verified</Badge>
                      ) : (
                        <Badge tone="warn">unverified</Badge>
                      )}
                    </span>
                  ) : (
                    'Not on this account'
                  ),
                ],
                ['Language', profile?.locale ?? 'en-IN'],
                ['Member since', account ? formatDate(account.createdAt) : '—'],
              ]}
            />
            <p className="tiny muted">
              Your email address and mobile number are how you sign in and how a code reaches you, so changing
              either is a verification flow rather than an edit — and there is no endpoint for it in this build.
              Nothing in {BRAND.name} is translated yet, so the language tag is stored and read by nothing.
            </p>
          </div>
        </Card>
      </section>

      {/* ── appearance ── */}
      <section aria-labelledby="appearance-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="appearance-heading">Appearance</h2>
        </div>
        <Card>
          <div className="stack stack-3">
            <div className="row-between setting-row">
              <div className="stack stack-1">
                <span className="h4">Theme</span>
                <span className="tiny muted">
                  Kept in a cookie so the server can draw the right colours before the first byte reaches you —
                  choosing dark never costs you a white flash.
                </span>
              </div>
              <ThemeToggle initial={theme} />
            </div>
            <p className="tiny muted">
              <Glyph name="moon" size={14} /> Light and dark are drawn separately rather than inverted.
              &ldquo;System&rdquo; follows the device and is the default.
            </p>
          </div>
        </Card>
      </section>

      {/* ── notifications ── */}
      <section aria-labelledby="notify-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="notify-heading">What you are told about</h2>
          <Link className="small" href="/notifications">
            Your inbox
          </Link>
        </div>

        <Card>
          <div className="stack stack-4">
            <SettingsNotifications initial={preferenceRows} />
            <Notice tone="neutral">
              <div className="stack stack-2">
                <strong>What these do today.</strong>
                <span>
                  Your choice is stored against your account and written to the audit trail. Nothing reads it
                  yet: your inbox keeps every notice whatever these say, because it is the record of what
                  happened to your account — and {BRAND.name} sends no email or SMS about an account on this
                  deployment at all.
                </span>
                <FeatureNote featureKey="notification-prefs" />
              </div>
            </Notice>
          </div>
        </Card>
      </section>

      {/* ── your data ── */}
      <section aria-labelledby="data-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="data-heading">Your data</h2>
          <StatusChip featureKey="data-export" />
        </div>
        <Card>
          <SettingsData graceDaysHint={GRACE_DAYS} />
        </Card>
        <FeatureNote featureKey="data-export" />
      </section>

      {/* ── where the rest of it lives ── */}
      <section aria-labelledby="elsewhere-heading" className="stack stack-4">
        <div className="section-head">
          <h2 id="elsewhere-heading">Elsewhere</h2>
        </div>
        <Card>
          <ul className="ledger">
            <li>
              <span className="ledger-main">
                <Link className="ledger-title" href="/profile">
                  Businesses and what they may read
                </Link>
                <span className="ledger-meta">
                  {activeConnections} connected · {liveConsents} live consent{liveConsents === 1 ? '' : 's'} ·
                  withdraw any of them
                </span>
              </span>
              <Glyph name="chevron" size={16} />
            </li>
            <li>
              <span className="ledger-main">
                <Link className="ledger-title" href="/profile">
                  Signed-in devices
                </Link>
                <span className="ledger-meta">
                  {sessions.length} live session{sessions.length === 1 ? '' : 's'} · sign one out, or all the
                  others
                </span>
              </span>
              <Glyph name="chevron" size={16} />
            </li>
            <li>
              <span className="ledger-main">
                <Link className="ledger-title" href="/disclosures">
                  What has been shared about you
                </Link>
                <span className="ledger-meta">Who saw what, when, and on what basis</span>
              </span>
              <Glyph name="chevron" size={16} />
            </li>
            <li>
              <span className="ledger-main">
                <Link className="ledger-title" href="/help">
                  Help
                </Link>
                <span className="ledger-meta">
                  One place for anything, whichever partner it happened at
                </span>
              </span>
              <Glyph name="chevron" size={16} />
            </li>
          </ul>
        </Card>
      </section>
    </div>
  );
}
