/**
 * The Control console's map, and the permission each part of it needs.
 *
 * Data rather than markup, so the layout can filter it against
 * `platformPermissions()` before rendering: platform support is not shown a link
 * to the security queue and then refused at it, and the security team is not
 * shown a link to platform-wide money it cannot read. The permission named here
 * is the same one the page itself authorizes — the nav is a convenience, never
 * the check.
 */
import type { Permission } from '@/lib/authz/permissions';

export interface AdminNavItem {
  /** Appended to `/control`. Empty string is the overview itself. */
  segment: string;
  label: string;
  permission: Permission;
}

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { segment: '', label: 'Overview', permission: 'platform.user:read' },
  { segment: 'users', label: 'Users', permission: 'platform.user:read' },
  { segment: 'partners', label: 'Partners', permission: 'platform.partner:read' },
  { segment: 'transactions', label: 'Transactions', permission: 'platform.transaction:read' },
  { segment: 'security', label: 'Security', permission: 'platform.security:read' },
  { segment: 'audit', label: 'Audit', permission: 'platform.audit:read' },
  { segment: 'support', label: 'Support', permission: 'platform.support:read' },
  { segment: 'credentials', label: 'Credentials', permission: 'platform.credential:read' },
  { segment: 'health', label: 'Health', permission: 'platform.health:read' },
];
