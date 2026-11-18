/**
 * Theme preference, readable on the server.
 *
 * Kept in a cookie rather than localStorage so the server can stamp
 * `data-theme` on <html> before the first byte reaches the browser — a
 * preference read by client script after paint is a white flash on every
 * load for somebody who chose dark. Absent means "follow the system", which
 * is what the CSS does with no attribute at all.
 *
 * Plain module, no JSX and no 'use client', so the root layout and the toggle
 * can both import it.
 */
export const THEME_COOKIE = 'op_theme';
export type ThemeChoice = 'system' | 'light' | 'dark';

export function parseTheme(value: string | undefined | null): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}
