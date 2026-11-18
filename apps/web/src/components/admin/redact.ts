/**
 * What the Control console is allowed to render of a person.
 *
 * These are the same two functions the admin API uses (src/app/api/admin/…), kept
 * here so the console and the API cannot drift apart on what "masked" means. The
 * rule they encode: an administrator's job — approving a partner, working a
 * security event, answering a ticket — does not require reading a consumer's
 * email address or mobile number, so the masked form is the only form these
 * screens produce. There is no query parameter that unmasks it, because a switch
 * that turns privacy off is a switch that gets turned off.
 *
 * Nothing here is a substitute for the other rule, which is enforced at every
 * call site rather than in a helper: a response object is built field by field.
 * `passwordHash`, `sessionGeneration` and `mfaSecretCipher` sit on the same row
 * as `displayName`, and the only defence that survives someone adding a column is
 * refusing to spread the row.
 */

/** `meera@example.in` → `m•••@example.in`. The domain is a routing detail, not an identifier. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

/** `+919876543201` → `+91 98•• ••01`: enough to confirm a number, never enough to dial one. */
export function maskMobile(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 6) return '•••• ••••';
  const local = digits.slice(-10);
  const country = digits.slice(0, digits.length - local.length);
  return `${country ? `+${country} ` : ''}${local.slice(0, 2)}•• ••${local.slice(-2)}`;
}

/** `%` and `_` are wildcards in LIKE; a search term is data, so they are escaped. */
export function likeTerm(input: string): string {
  return `%${input.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** The first value of a query parameter, trimmed, or null. */
export function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/** One member of a literal union from a query string, or null. Never a cast alone. */
export function oneOf<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : null;
}

/**
 * A `YYYY-MM-DD` from a date input, as a Date, or null.
 *
 * Parsed strictly: an unparseable value is dropped rather than silently becoming
 * an epoch date that would quietly widen a filter to everything.
 */
export function dayParam(value: string | string[] | undefined, endOfDay = false): Date | null {
  const raw = firstParam(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Preserve the filters already in the URL while changing one of them. */
export function withParam(
  base: string,
  current: Record<string, string | null>,
  change: Record<string, string | null>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...change })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
