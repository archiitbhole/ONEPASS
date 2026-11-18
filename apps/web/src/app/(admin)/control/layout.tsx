/**
 * ONEPASS Control — the platform console shell.
 *
 * The third isolation boundary. Everything below this layout crosses tenants by
 * design: platform-wide transactions, every partner's application, the audit
 * trail of the whole system. That is only safe because the permission it takes to
 * get here cannot be reached from a membership — `authorize()` computes a
 * `platform.*` permission from `actor.platformRoles` and additionally requires
 * `isPlatformStaff`, so a partner owner holding PARTNER_OWNER at six
 * organizations holds nothing here, and is answered 404 rather than 403.
 *
 * The layout authorizes with the weakest platform permission there is —
 * `platform.user:read`, which PLATFORM_ADMIN, PLATFORM_SUPPORT and SECURITY_ADMIN
 * all hold — purely to establish that the caller is platform staff at all. Every
 * page then authorizes again with the permission its own work needs. Two checks
 * rather than one, because a layout that vouched for its children would make the
 * children's own guards optional, and optional guards rot.
 *
 * The sidebar is filtered against the permissions the guard returned, so platform
 * support is not shown a link to platform-wide money and then refused at it. That
 * filtering is a courtesy — the page behind each link authorizes for itself.
 *
 * The brand reads "ONEPASS Control" rather than "ONEPASS Business". Two consoles
 * that look alike are two consoles somebody eventually confuses.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Badge, Monogram } from '@/components/ui';
import { requirePlatform } from '@/components/admin/guard';
import { ADMIN_NAV_ITEMS } from '@/components/admin/nav-items';
import { ConsoleShell } from '@/components/console/shell';
import type { GlyphName } from '@/components/icons';
import { BRAND, consoleName, titleTemplate } from '@/lib/brand';

export const metadata: Metadata = {
  title: { default: BRAND.consoles.platform, template: titleTemplate(consoleName('platform')) },
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const GLYPHS: Record<string, GlyphName> = {
  '': 'chart',
  users: 'users',
  partners: 'building',
  transactions: 'receipt',
  security: 'shield',
  audit: 'eye',
  support: 'help',
  credentials: 'lock',
  health: 'signal',
};

export default async function ControlLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePlatform('platform.user:read');

  const items = ADMIN_NAV_ITEMS.filter((item) => ctx.permissions.has(item.permission)).map((item) => ({
    href: item.segment ? `/control/${item.segment}` : '/control',
    label: item.label,
    glyph: GLYPHS[item.segment],
    exact: item.segment === '',
  }));

  const role = (ctx.actor.platformRoles.find((name) => name !== 'CONSUMER') ?? 'PLATFORM_STAFF')
    .replace('PLATFORM_', '')
    .replace(/_/g, ' ')
    .toLowerCase();

  return (
    // The coldest register, and deliberately the least inviting. A control
    // room should have depth without ever looking like somewhere to spend time.
    <ConsoleShell
      surface="control"
      brandHref="/control"
      brandSubtitle={BRAND.consoles.platform}
      context="Platform operations"
      contextDetail={`Your role · ${role}`}
      navLabel="Platform control console"
      groups={[{ label: 'Platform', items }]}
      barEnd={
        <span className="console-user">
          <Badge tone="info">{role}</Badge>
          <span className="console-user-name">{ctx.actor.displayName}</span>
          <Monogram name={ctx.actor.displayName} size={30} tone="info" />
        </span>
      }
      footnote={
        <>
          {consoleName('platform')} · platform staff only. Contact details are masked on every screen here,
          and no page in this console renders a password hash, a session token or a pass secret — those
          columns are never selected. Every change made from these screens is written to the audit trail
          with the reason given for it.
        </>
      }
    >
      {children}
    </ConsoleShell>
  );
}
