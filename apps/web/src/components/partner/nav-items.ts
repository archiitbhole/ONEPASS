/**
 * The console's map, and the permission each part of it needs.
 *
 * Kept as data rather than as markup so the layout can filter it against
 * `permissionsAt()` before rendering: a counter user is not shown a link to the
 * API keys page and then refused at it. The permission named here is the same one
 * the page itself authorizes — the nav is a convenience, never the check.
 */
import type { Permission } from '@/lib/authz/permissions';

export interface NavItem {
  segment: string;
  label: string;
  group: string;
  permission: Permission;
  /**
   * False for a section whose service is not present in this build. Rendered as
   * a dead entry rather than a link, so the console shows its whole shape without
   * offering a door that opens onto a 404.
   */
  built?: boolean;
  /**
   * Shown on the disabled entry, so "why is this grey" has an answer on the
   * page. Written for the merchant reading it — not a source path, which tells
   * them nothing they can act on and dates the moment the file moves.
   */
  unavailableNote?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { segment: 'dashboard', label: 'Dashboard', group: 'Operate', permission: 'partner.analytics:read' },
  { segment: 'bookings', label: 'Bookings', group: 'Operate', permission: 'partner.transaction:read' },
  { segment: 'door', label: 'Door', group: 'Operate', permission: 'partner.pass:verify' },
  { segment: 'counter', label: 'Counter', group: 'Operate', permission: 'partner.transaction:create' },

  { segment: 'deals', label: 'Live Deals', group: 'Sell', permission: 'partner.org:read' },
  { segment: 'inventory', label: 'Inventory', group: 'Sell', permission: 'partner.org:read' },
  { segment: 'offers', label: 'Offers', group: 'Sell', permission: 'partner.org:read' },

  { segment: 'customers', label: 'Customers', group: 'Relationships', permission: 'partner.customer:read' },
  { segment: 'receipts', label: 'Receipts', group: 'Relationships', permission: 'partner.transaction:read' },
  { segment: 'returns', label: 'Returns', group: 'Relationships', permission: 'partner.transaction:read' },
  { segment: 'loyalty', label: 'Loyalty', group: 'Relationships', permission: 'partner.org:read' },

  { segment: 'insights', label: 'Insights', group: 'Analysis', permission: 'partner.analytics:read' },
  { segment: 'demand', label: 'Demand', group: 'Analysis', permission: 'partner.analytics:read' },
  {
    segment: 'campaigns',
    label: 'Campaigns',
    group: 'Analysis',
    permission: 'partner.analytics:read',
    built: false,
    unavailableNote:
      'Not in this build. Nothing behind this would work, so it is shown rather than hidden — the console’s shape should not change depending on what is finished.',
  },

  { segment: 'api', label: 'API', group: 'Develop', permission: 'partner.apikey:read' },
  { segment: 'settings', label: 'Settings', group: 'Develop', permission: 'partner.org:read' },
];

export const NAV_GROUPS = ['Operate', 'Sell', 'Relationships', 'Analysis', 'Develop'] as const;
