/**
 * The pass package carries the two pieces of cryptography ONEPASS cannot get wrong.
 * Both are checked against independent implementations rather than against themselves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import refEncoder from 'qrcode';
import jsQR from 'jsqr';

import { encode } from '../src/qr.js';
import {
  base32Encode,
  base32Decode,
  totp,
  totpForCounter,
  counterAt,
  mintEnvelope,
  parseEnvelope,
  verifyEnvelope,
  generatePassSecret,
  TOTP_STEP_SECONDS,
} from '../dist/totp.js';

/* ── QR encoder ─────────────────────────────────────────────── */

function render(matrix, scale = 4, quietModules = 4) {
  const n = matrix.length;
  const quiet = quietModules * scale;
  const dim = n * scale + quiet * 2;
  const buf = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const p = ((quiet + y * scale + dy) * dim + (quiet + x * scale + dx)) * 4;
          buf[p] = buf[p + 1] = buf[p + 2] = 0;
        }
      }
    }
  }
  return { buf, dim };
}

test('QR: every encoding round-trips through an independent decoder', () => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_|:/';
  const samples = ['OP1|px_9f31c2|482913|58554667', 'a', 'x'.repeat(90)];
  for (let i = 0; i < 40; i++) {
    let s = '';
    const len = 1 + Math.floor(Math.random() * 80);
    for (let j = 0; j < len; j++) s += chars[Math.floor(Math.random() * chars.length)];
    samples.push(s);
  }

  let checked = 0;
  for (const s of samples) {
    for (const level of ['L', 'M', 'Q', 'H']) {
      const m = encode(s, level);
      const { buf, dim } = render(m);
      const decoded = jsQR(buf, dim, dim);
      assert.ok(decoded, `no code found for ${JSON.stringify(s.slice(0, 24))} @ ${level}`);
      assert.equal(decoded.data, s);
      checked++;
    }
  }
  assert.ok(checked >= 170, `expected a broad sweep, got ${checked}`);
});

test('QR: byte-mode matrices are identical to a reference encoder', () => {
  const samples = ['x'.repeat(60), 'hello onepass', 'op1|px_9f31c2|482913|58554667'];
  let compared = 0;
  for (const s of samples) {
    for (const level of ['L', 'M', 'Q', 'H']) {
      const ref = refEncoder.create(s, { errorCorrectionLevel: level });
      if (!ref.segments.every((seg) => seg.mode.id === 'Byte')) continue;
      const mine = encode(s, level);
      assert.equal(mine.length, ref.modules.size, 'version mismatch');
      for (let y = 0; y < mine.length; y++) {
        for (let x = 0; x < mine.length; x++) {
          assert.equal(mine[y][x], !!ref.modules.data[y * mine.length + x], `module ${y},${x} differs`);
        }
      }
      compared++;
    }
  }
  assert.ok(compared >= 8, `expected several byte-mode comparisons, got ${compared}`);
});

/* ── TOTP ───────────────────────────────────────────────────── */

test('TOTP: matches the RFC 6238 SHA-256 test vectors', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890123456789012', 'utf8'));
  const vectors = [
    [59, '46119246'],
    [1111111109, '68084774'],
    [1111111111, '67062674'],
    [1234567890, '91819424'],
    [2000000000, '90698825'],
    [20000000000, '77737706'],
  ];
  for (const [t, expected] of vectors) {
    assert.equal(totp(secret, t, 8, 30), expected, `vector at t=${t}`);
  }
});

test('TOTP: matches an independent implementation across random secrets', () => {
  for (let i = 0; i < 50; i++) {
    const raw = crypto.randomBytes(20);
    const secret = base32Encode(raw);
    const counter = Math.floor(Math.random() * 2 ** 31);

    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const mac = crypto.createHmac('sha256', raw).update(msg).digest();
    const off = mac[mac.length - 1] & 0x0f;
    const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    const expected = String(bin % 1e6).padStart(6, '0');

    assert.equal(totpForCounter(secret, counter), expected);
    assert.deepEqual(base32Decode(secret), raw, 'base32 round-trip');
  }
});

test('generated secrets are 160-bit and distinct', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const s = generatePassSecret();
    assert.equal(base32Decode(s).length, 20);
    assert.ok(!seen.has(s), 'secrets must not repeat');
    seen.add(s);
  }
});

/* ── envelope verification ──────────────────────────────────── */

test('envelope: accepts the current window and the neighbouring one', () => {
  const secret = generatePassSecret();
  const now = 1_800_000_000;
  const c = counterAt(now);

  for (const counter of [c - 1, c, c + 1]) {
    const env = mintEnvelope('px_abc123', secret, counter);
    const res = verifyEnvelope(env, secret, { now });
    assert.equal(res.ok, true, `window ${counter - c} should be accepted`);
    if (res.ok) assert.equal(res.counter, counter);
  }
});

test('envelope: rejects stale, forged and malformed codes', () => {
  const secret = generatePassSecret();
  const other = generatePassSecret();
  const now = 1_800_000_000;
  const c = counterAt(now);

  const stale = verifyEnvelope(mintEnvelope('px_abc123', secret, c - 4), secret, { now });
  assert.equal(stale.ok, false);
  assert.equal(stale.ok === false && stale.reason, 'expired');

  const forged = verifyEnvelope(mintEnvelope('px_abc123', other, c), secret, { now });
  assert.equal(forged.ok, false);
  assert.equal(forged.ok === false && forged.reason, 'signature');

  for (const junk of ['', 'nonsense', 'OP1|px|1|1', 'OP2|px_abc123|000000|1', 'OP1|px_abc123|abcdef|1', `OP1|px_abc123|000000|-1`]) {
    const res = verifyEnvelope(junk, secret, { now });
    assert.equal(res.ok, false, `should reject ${JSON.stringify(junk)}`);
  }

  // brute force: a wrong 6-digit code must never pass
  const real = parseEnvelope(mintEnvelope('px_abc123', secret, c));
  let accepted = 0;
  for (let guess = 0; guess < 2000; guess++) {
    const code = String(guess).padStart(6, '0');
    if (code === real.code) continue;
    const res = verifyEnvelope(`OP1|px_abc123|${code}|${c}`, secret, { now });
    if (res.ok) accepted++;
  }
  assert.equal(accepted, 0, 'no wrong code may verify');
});

test('envelope: parse rejects injection-shaped pass references', () => {
  for (const bad of ["px_'; DROP TABLE users;--", 'px_<script>', 'px_' + 'a'.repeat(200), 'px a']) {
    assert.equal(parseEnvelope(`OP1|${bad}|000000|1`), null, `should reject ${bad.slice(0, 20)}`);
  }
});

test('envelope stays inside a low QR version so it scans quickly', () => {
  const env = mintEnvelope('px_' + 'a'.repeat(24), generatePassSecret());
  const m = encode(env, 'M');
  assert.ok(m.length <= 41, `expected version 6 or lower, got ${(m.length - 17) / 4}`);
  assert.equal(TOTP_STEP_SECONDS, 30);
});
