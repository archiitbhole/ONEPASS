'use client';

/**
 * A console's section list.
 *
 * A client component for one reason — `usePathname()`, so the current section
 * carries `aria-current="page"`. The items arrive computed on the server and
 * already filtered by permission; nothing here decides what anyone may see.
 * Partner and Control each pass their own landmark label, so a screen reader
 * is told which console it is in.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Glyph, type GlyphName } from '@/components/icons';

export interface ConsoleNavItem {
  href: string;
  label: string;
  glyph?: GlyphName;
  /** False renders a disabled entry with `note` as its explanation. */
  available?: boolean;
  note?: string;
  /** Only the exact path lights it (an overview whose children are siblings). */
  exact?: boolean;
}

export interface ConsoleNavGroup {
  label: string;
  items: ConsoleNavItem[];
}

export function ConsoleNav({ label, groups }: { label: string; groups: ConsoleNavGroup[] }) {
  const pathname = usePathname() ?? '';
  return (
    <nav className="console-nav" aria-label={label}>
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <div key={group.label} className="console-nav-group">
            <p className="console-nav-head">{group.label}</p>
            {group.items.map((item) => {
              const current = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              if (item.available === false) {
                return (
                  <span key={item.href} className="console-nav-off" aria-disabled="true" title={item.note}>
                    {item.glyph ? <Glyph name={item.glyph} size={18} /> : null}
                    {item.label}
                    <span className="sr-only"> — {item.note ?? 'not available'}</span>
                  </span>
                );
              }
              return (
                <Link key={item.href} href={item.href} aria-current={current ? 'page' : undefined}>
                  {item.glyph ? <Glyph name={item.glyph} size={18} /> : null}
                  {item.label}
                </Link>
              );
            })}
          </div>
        ),
      )}
    </nav>
  );
}
