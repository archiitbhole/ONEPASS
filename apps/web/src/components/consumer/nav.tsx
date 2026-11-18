'use client';

/**
 * The consumer navigation: the dock on a phone, the bar on a desktop.
 *
 * A client component for one reason — `aria-current` needs the current path,
 * and a nav that cannot say where you are fails a screen reader. The lists
 * live in `places.ts`, with every other screen, so the dock, the bar and the
 * command palette cannot describe the product differently.
 *
 * The current destination sits on a bead that carries a view-transition name:
 * moving between destinations slides the bead rather than blinking it. The
 * pass sits in the middle of the dock as a small card — tap it and the card
 * opens into the live code.
 */
import { usePathname } from 'next/navigation';
import { Glyph, type GlyphName } from '@/components/icons';
import { TransitionLink } from '@/components/system/view-transitions';
import { DESK_PLACES, DOCK_PLACES, placeIsActive } from './places';

const GLYPHS: Record<string, GlyphName> = {
  '/home': 'home',
  '/explore': 'explore',
  '/plan': 'plan',
  '/travel': 'travel',
  '/wallet': 'wallet',
  '/pass': 'pass',
  '/profile': 'profile',
};

/** The desktop bar. Hidden under 900px, where the dock does the same job. */
export function ConsumerDeskNav() {
  const pathname = usePathname() ?? '/';
  return (
    <nav className="navlinks appnav" aria-label="Main">
      {DESK_PLACES.map((place) => {
        const current = placeIsActive(pathname, place);
        return (
          <TransitionLink
            key={place.href}
            href={place.href}
            className="navlink"
            aria-current={current ? 'page' : undefined}
          >
            {current ? <span className="bead" aria-hidden="true" /> : null}
            {place.label}
          </TransitionLink>
        );
      })}
    </nav>
  );
}

/**
 * The dock.
 *
 * Rendered as a sibling of the app bar rather than inside it: the bar has a
 * `backdrop-filter`, which makes it the containing block for any fixed
 * descendant, and a dock pinned to the bottom of the header is not a dock.
 */
export function ConsumerDock() {
  const pathname = usePathname() ?? '/';
  return (
    <nav className="dock" aria-label="Main">
      {DOCK_PLACES.map((place) => {
        const current = placeIsActive(pathname, place);
        if (place.href === '/pass') {
          return (
            <TransitionLink
              key={place.href}
              href={place.href}
              className="dock-item dock-pass"
              aria-current={current ? 'page' : undefined}
            >
              <span className="dock-pass-card" aria-hidden="true">
                <i />
              </span>
              <span>{place.label}</span>
            </TransitionLink>
          );
        }
        return (
          <TransitionLink
            key={place.href}
            href={place.href}
            className="dock-item"
            aria-current={current ? 'page' : undefined}
          >
            {current ? <span className="bead" aria-hidden="true" /> : null}
            <Glyph name={GLYPHS[place.href] ?? 'dot'} size={22} />
            <span>{place.label}</span>
          </TransitionLink>
        );
      })}
    </nav>
  );
}
