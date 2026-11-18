/**
 * ONEPASS pass tokens.
 *
 * A pass token is a short, single-use, time-bounded proof that the holder of a
 * ONEPASS identity is present. It is an RFC 6238 TOTP over HMAC-SHA256, bound to
 * a per-pass secret that never leaves the server, wrapped in a small envelope the
 * merchant terminal can parse before doing any cryptography.
 *
 * The secret is the security boundary. Everything here assumes it is read from
 * an encrypted column server-side and is never sent to a client.
 */
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const ENVELOPE_VERSION = 'OP1';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array | Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  const s = input.replace(/=+$/, '').toUpperCase();
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh, high-entropy pass secret. 20 bytes = 160 bits, the RFC 4226 recommendation. */
export function generatePassSecret(): string {
  return base32Encode(randomBytes(20));
}

export function counterAt(unixSeconds: number, step = TOTP_STEP_SECONDS): number {
  return Math.floor(unixSeconds / step);
}

export function counterNow(step = TOTP_STEP_SECONDS): number {
  return counterAt(Math.floor(Date.now() / 1000), step);
}

/** RFC 6238 TOTP over HMAC-SHA256, with RFC-correct dynamic truncation. */
export function totpForCounter(secretB32: string, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha256', base32Decode(secretB32)).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totp(secretB32: string, unixSeconds: number, digits = TOTP_DIGITS, step = TOTP_STEP_SECONDS): string {
  return totpForCounter(secretB32, counterAt(unixSeconds, step), digits);
}

export interface PassEnvelope {
  version: string;
  passRef: string;
  code: string;
  counter: number;
}

/** `OP1|<passRef>|<code>|<counter>` — short enough for a low QR version, so it scans fast. */
export function mintEnvelope(passRef: string, secretB32: string, counter = counterNow()): string {
  return [ENVELOPE_VERSION, passRef, totpForCounter(secretB32, counter), String(counter)].join('|');
}

export function parseEnvelope(raw: string): PassEnvelope | null {
  const parts = String(raw ?? '').trim().split('|');
  if (parts.length !== 4) return null;
  const [version, passRef, code, counterRaw] = parts as [string, string, string, string];
  if (version !== ENVELOPE_VERSION) return null;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(passRef)) return null;
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return null;
  const counter = Number(counterRaw);
  if (!Number.isSafeInteger(counter) || counter < 0) return null;
  return { version, passRef, code, counter };
}

export type PassCheck =
  | { ok: true; counter: number; driftWindows: number }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

/**
 * Verify a presented envelope.
 *
 * `driftWindows` accepts a clock skew of ±1 step by default — the same tolerance an
 * authenticator app uses — and reports which window matched so the caller can record
 * it for replay protection. Comparison is constant-time.
 */
export function verifyEnvelope(
  raw: string,
  secretB32: string,
  opts: { now?: number; driftWindows?: number; step?: number } = {},
): PassCheck {
  const step = opts.step ?? TOTP_STEP_SECONDS;
  const drift = opts.driftWindows ?? 1;
  const parsed = parseEnvelope(raw);
  if (!parsed) return { ok: false, reason: 'malformed' };

  const expected = totpForCounter(secretB32, parsed.counter);
  const a = Buffer.from(expected);
  const b = Buffer.from(parsed.code);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'signature' };

  const nowCounter = counterAt(opts.now ?? Math.floor(Date.now() / 1000), step);
  const delta = Math.abs(nowCounter - parsed.counter);
  if (delta > drift) return { ok: false, reason: 'expired' };

  return { ok: true, counter: parsed.counter, driftWindows: delta };
}

/** Seconds until the current window rolls — drives the countdown ring in the UI. */
export function secondsUntilRoll(step = TOTP_STEP_SECONDS): number {
  return step - (Math.floor(Date.now() / 1000) % step);
}
