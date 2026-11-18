'use client';

/**
 * Appearance: follow the system, or always light, or always dark.
 *
 * Client-side for one reason — it writes a cookie and flips the attribute on
 * <html> without a reload. The choice is three labelled buttons in a group
 * rather than an icon that cycles: an icon that cycles tells nobody what the
 * next press will do, and a screen reader hears "button" three times.
 */
import { useState } from 'react';
import { THEME_COOKIE, type ThemeChoice } from './theme';

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeToggle({ initial, compact = false }: { initial: ThemeChoice; compact?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  function choose(next: ThemeChoice) {
    setChoice(next);
    const root = document.documentElement;
    if (next === 'system') {
      delete root.dataset.theme;
      document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    } else {
      root.dataset.theme = next;
      // A year. Not a secret and not personal: it is which colours to draw.
      document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
  }

  return (
    <div className={compact ? 'segmented segmented-sm' : 'segmented'} role="group" aria-label="Appearance">
      {CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          className="segment"
          aria-pressed={choice === c.value}
          onClick={() => choose(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
