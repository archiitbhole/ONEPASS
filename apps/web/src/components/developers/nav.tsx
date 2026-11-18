'use client';

/**
 * The documentation sidebar.
 *
 * Client-side only because `aria-current` needs the current path, and marking
 * the current page is not decoration: it is how someone three pages deep knows
 * where they are. Everything else about the sidebar — its contents, its order —
 * comes from the server as a prop.
 *
 * Sub-links are anchors within a page. They are shown only while that page is
 * open, because a permanently expanded tree of every anchor in the reference is
 * a wall of links rather than a way to navigate.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavLink {
  href: string;
  label: string;
  /** In-page anchors, revealed when this page is the current one. */
  children?: { href: string; label: string }[];
}

export interface NavGroup {
  heading: string;
  links: NavLink[];
}

export function DocsNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="docs-nav" aria-label="Documentation">
      {groups.map((group) => (
        <div key={group.heading} className="docs-nav-group">
          <p className="docs-nav-head">{group.heading}</p>
          {group.links.map((link) => {
            const current = pathname === link.href;
            return (
              <div key={link.href}>
                <Link href={link.href} aria-current={current ? 'page' : undefined}>
                  {link.label}
                </Link>
                {current && link.children
                  ? link.children.map((child) => (
                      <a key={child.href} className="sub" href={child.href}>
                        {child.label}
                      </a>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
