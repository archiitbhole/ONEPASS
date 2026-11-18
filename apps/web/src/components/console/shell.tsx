/**
 * The console frame, shared by Business and Control.
 *
 * Desktop first: a rail of sections on the left, a sticky bar with where you
 * are and who you are, and a wide working area. On a tablet or phone the rail
 * becomes a disclosure — a real <details>, so it opens without JavaScript and
 * closes with the keyboard.
 *
 * The two consoles share the frame and differ in register (`data-surface`):
 * Business is paper with a jade accent; Control's rail is night ink in both
 * themes with an indigo accent, so nobody mistakes the platform's operations
 * room for a storefront.
 */
import type { ReactNode } from 'react';
import { Brand } from '@/components/ui';
import { Glyph } from '@/components/icons';
import { ConsoleNav, type ConsoleNavGroup } from './nav';

export function ConsoleShell({
  surface,
  brandHref,
  brandSubtitle,
  context,
  contextDetail,
  navLabel,
  groups,
  barEnd,
  railFoot,
  footnote,
  children,
}: {
  surface: 'partner' | 'control';
  brandHref: string;
  brandSubtitle: string;
  /** What this console is looking at: the organization, or "Platform operations". */
  context: ReactNode;
  contextDetail?: ReactNode;
  navLabel: string;
  groups: ConsoleNavGroup[];
  barEnd?: ReactNode;
  railFoot?: ReactNode;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="console-shell" data-surface={surface}>
      {surface === 'partner' ? <div className="ambient" aria-hidden="true" /> : null}
      <aside className="console-rail">
        <Brand href={brandHref} subtitle={brandSubtitle} />
        <div className="console-org">
          <span className="console-org-name">{context}</span>
          {contextDetail ? <span className="tiny muted">{contextDetail}</span> : null}
        </div>
        <ConsoleNav label={navLabel} groups={groups} />
        {railFoot ? <div className="console-rail-foot">{railFoot}</div> : null}
      </aside>

      <div className="console-body">
        <div className="console-bar">
          <div className="row" style={{ minWidth: 0, gap: 10 }}>
            <details className="console-menu">
              <summary>
                <Glyph name="menu" size={18} />
                <span>Menu</span>
              </summary>
              <div className="console-menu-panel">
                <ConsoleNav label={navLabel} groups={groups} />
              </div>
            </details>
            <span className="console-bar-brand">
              <Brand href={brandHref} subtitle={brandSubtitle} />
            </span>
          </div>
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            {barEnd}
          </div>
        </div>
        <main id="main" className="console-main">
          {children}
        </main>
        {footnote ? (
          <footer className="console-foot">
            <p>{footnote}</p>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
