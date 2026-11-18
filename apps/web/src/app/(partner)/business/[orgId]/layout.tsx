/**
 * ONEPASS Merchant OS — the console shell.
 *
 * Everything below this layout is one tenant's operation. The layout authorizes
 * once with the weakest partner permission there is (`partner.org:read`, which
 * every member role holds) purely to establish *which* organization this is; each
 * page then authorizes again with the permission its own work needs. Two checks
 * rather than one shared check, because a layout that vouched for its children
 * would make the children's own guards optional, and optional guards rot.
 *
 * The sidebar is filtered against the permissions the guard returned, so a counter
 * user does not see a link to API keys and then get refused at it. That filtering
 * is a courtesy — the page behind each link authorizes for itself.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { Badge, Monogram } from '@/components/ui';
import { requirePartner } from '@/components/partner/guard';
import { NAV_GROUPS, NAV_ITEMS } from '@/components/partner/nav-items';
import { OrgSwitcher } from '@/components/partner/shell';
import { ConsoleShell } from '@/components/console/shell';
import type { ConsoleNavGroup } from '@/components/console/nav';
import type { GlyphName } from '@/components/icons';
import { getActor } from '@/lib/authz/authorize';
import { BRAND, consoleName, titleTemplate } from '@/lib/brand';

export const metadata: Metadata = {
  title: { default: BRAND.consoles.partner, template: titleTemplate(consoleName('partner')) },
  robots: { index: false, follow: false },
};

const GLYPHS: Record<string, GlyphName> = {
  dashboard: 'chart',
  bookings: 'calendar',
  door: 'door',
  deals: 'tag',
  inventory: 'signal',
  offers: 'ticket',
  customers: 'users',
  receipts: 'receipt',
  returns: 'returns',
  loyalty: 'savings',
  credentials: 'shield',
  insights: 'sparkline',
  demand: 'chart',
  campaigns: 'dot',
  api: 'key',
  settings: 'settings',
};

/**
 * Move the console to another organization the caller belongs to.
 *
 * The posted id is a request, not a decision: membership is re-read from the
 * session's own actor before the redirect, so a hand-edited option value lands on
 * a 404 rather than on someone else's tenant. The destination page authorizes
 * again regardless.
 */
async function switchOrganization(formData: FormData): Promise<void> {
  'use server';

  const target = String(formData.get('organizationId') ?? '');
  const actor = await getActor();
  const allowed = actor?.memberships.some(
    (m) => m.organizationId === target && m.status === 'ACTIVE' && m.organizationStatus === 'ACTIVE',
  );

  if (!allowed) notFound();
  redirect(`/business/${target}/dashboard`);
}

export default async function BusinessLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const ctx = await requirePartner('partner.org:read', orgId);
  const base = `/business/${ctx.organizationId}`;

  // Filtered against the permissions the guard returned, so counter staff are
  // not shown API keys and then refused at them. A courtesy — each page
  // authorizes for itself.
  const groups: ConsoleNavGroup[] = NAV_GROUPS.map((group) => ({
    label: group,
    items: NAV_ITEMS.filter((item) => item.group === group && ctx.permissions.has(item.permission)).map((item) => ({
      href: `${base}/${item.segment}`,
      label: item.label,
      glyph: GLYPHS[item.segment],
      available: item.built !== false,
      note: item.unavailableNote,
    })),
  }));

  const switchable = ctx.actor.memberships
    .filter((m) => m.status === 'ACTIVE' && m.organizationStatus === 'ACTIVE')
    .map((m) => ({ organizationId: m.organizationId, organizationName: m.organizationName }));

  const role = (ctx.membership?.roles[0] ?? 'PARTNER_STAFF').replace('PARTNER_', '').toLowerCase();

  return (
    // Denser and cooler than the consumer app: an operator scans, they do not
    // browse. The register is set by data-surface — see tokens.css.
    <ConsoleShell
      surface="partner"
      brandHref={`${base}/dashboard`}
      brandSubtitle={BRAND.consoles.partner}
      context={ctx.membership?.organizationName ?? 'Organization'}
      contextDetail={`Your role · ${role}`}
      navLabel="Business console"
      groups={groups}
      barEnd={
        <>
          <OrgSwitcher current={ctx.organizationId} organizations={switchable} action={switchOrganization} />
          <span className="console-user">
            <Badge tone="neutral">{role}</Badge>
            <span className="console-user-name">{ctx.actor.displayName}</span>
            <Monogram name={ctx.actor.displayName} size={30} tone="neutral" />
          </span>
        </>
      }
      footnote={
        <>
          {consoleName('partner')} · every figure on these screens is read from this organization&rsquo;s
          own rows. Customer identity is disclosed only where a consumer has granted it.
        </>
      }
    >
      {children}
    </ConsoleShell>
  );
}
