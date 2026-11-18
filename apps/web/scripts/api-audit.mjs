/**
 * Throw bad input at every endpoint and check what comes back.
 *
 * Not a replacement for the integration suite, which tests what the API does
 * when it is used correctly. This tests the other half: what it does when it is
 * used wrongly, carelessly, or maliciously — which is the half that decides
 * whether the thing is safe to put on the internet.
 *
 * Three properties are checked on every response, whatever it is:
 *
 *  1. **It is a considered answer, not a crash.** A 500 to a malformed body is
 *     an unhandled exception with a status code painted on it.
 *  2. **It leaks nothing.** No stack trace, no SQL, no file path, no driver
 *     message, no environment variable. A caller learns what they did wrong and
 *     nothing about how the server is built.
 *  3. **It carries a request id**, so a person who hits a genuine fault has
 *     something to quote.
 *
 * **The burst test at the end spends the verification rate limit**, so two runs
 * inside a minute will see the second one refused. That is the limiter working;
 * clear the window (`redis-cli --scan --pattern 'rl:*' | xargs redis-cli del`)
 * or wait it out rather than raising the limit to make a test pass.
 *
 * Run: node scripts/api-audit.mjs <baseUrl>
 */
import fs from 'node:fs';

const baseUrl = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
const SESSIONS = '/tmp/onepass-e2e-sessions.json';
const sessions = fs.existsSync(SESSIONS) ? JSON.parse(fs.readFileSync(SESSIONS, 'utf8')) : {};

const findings = [];
const passed = [];
function fail(what, detail) {
  findings.push({ what, detail });
}

/** Anything that should never appear in a response body. */
const LEAKS = [
  [/\bat\s+[A-Za-z0-9_$.]+\s+\(/, 'a stack frame'],
  [/\/home\/[a-z]+\//i, 'a filesystem path'],
  [/node_modules/, 'a module path'],
  [/postgres(?:ql)?:\/\//i, 'a database URL'],
  [/\bselect\s+.+\s+from\s+/i, 'a SQL statement'],
  [/duplicate key value|violates \w+ constraint|relation "/i, 'a driver message'],
  [/ENCRYPTION_KEY|HASH_PEPPER|SESSION_SECRET|RAZORPAY_KEY_SECRET/i, 'an environment variable'],
  [/\$2[aby]\$|\$argon2/i, 'a password hash'],
];

async function call(method, path, { body, raw, headers = {}, as = null, expect: want } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (as) init.headers.cookie = `onepass_session=${sessions[as] ?? 'nonsense'}`;
  if (raw !== undefined) {
    init.headers['content-type'] ??= 'application/json';
    init.body = raw;
  } else if (body !== undefined) {
    init.headers['content-type'] ??= 'application/json';
    init.body = JSON.stringify(body);
  }
  // Every state-changing route checks the Origin header. Sending it is what a
  // browser does; the CSRF behaviour is tested separately and deliberately.
  if (method !== 'GET' && !('origin' in init.headers)) init.headers.origin = baseUrl;

  let res;
  let text = '';
  try {
    res = await fetch(baseUrl + path, init);
    text = await res.text();
  } catch (err) {
    fail(`${method} ${path}`, `did not respond: ${String(err).slice(0, 120)}`);
    return null;
  }

  const label = `${method} ${path}`;

  for (const [pattern, what] of LEAKS) {
    if (pattern.test(text)) fail(label, `response contains ${what}: ${text.slice(0, 160)}`);
  }

  if (res.status >= 500 && want !== 500 && !(Array.isArray(want) && want.includes(500))) {
    fail(label, `HTTP ${res.status} — a considered refusal would be a 4xx. Body: ${text.slice(0, 200)}`);
  }

  // `expect` may be a list where two answers are both correct — a session that
  // has lapsed out of elevation answers 401 where a live one answers 404, and
  // insisting on one of them would make this file fail for a reason that is not
  // about the endpoint.
  const wanted = want === undefined ? undefined : Array.isArray(want) ? want : [want];
  if (wanted && !wanted.includes(res.status)) {
    fail(label, `expected HTTP ${wanted.join(' or ')}, got ${res.status}. Body: ${text.slice(0, 200)}`);
  } else if (wanted) {
    passed.push(label);
  }

  if (res.status >= 400 && res.status !== 401 && res.headers.get('x-request-id') === null) {
    fail(label, 'no x-request-id on an error a caller may need to report');
  }

  return { status: res.status, text, headers: res.headers };
}

/* ─────────────────────────  the checks  ───────────────────────── */

const VERIFY = '/api/v1/verify';

// ── malformed and hostile bodies on the one open write endpoint ──
// An empty body parses to `{}` and then fails the schema, which is a better
// answer than a flat 400: `details.fields` names `reference` as required.
await call('POST', VERIFY, { raw: '', expect: 422 });
await call('POST', VERIFY, { raw: 'not json at all', expect: 400 });
await call('POST', VERIFY, { raw: '{"reference":', expect: 400 });
await call('POST', VERIFY, { body: {}, expect: 422 });
await call('POST', VERIFY, { body: { reference: '' }, expect: 422 });
await call('POST', VERIFY, { body: { reference: 'ab' }, expect: 422 });
await call('POST', VERIFY, { body: { reference: 'x'.repeat(65) }, expect: 422 });
await call('POST', VERIFY, { body: { reference: null }, expect: 422 });
await call('POST', VERIFY, { body: { reference: 12345 }, expect: 422 });
await call('POST', VERIFY, { body: { reference: ['a', 'b'] }, expect: 422 });
await call('POST', VERIFY, { body: { reference: { nested: true } }, expect: 422 });

// A resolved verdict is a 200 whatever the verdict is — including "no such
// thing". That is the API's central promise and the easiest one to break.
await call('POST', VERIFY, { body: { reference: 'cred_definitely_not_real' }, expect: 200 });
await call('POST', VERIFY, { body: { reference: '../../etc/passwd' }, expect: 200 });
await call('POST', VERIFY, { body: { reference: "'; DROP TABLE users; --" }, expect: 200 });
await call('POST', VERIFY, { body: { reference: '<script>alert(1)</script>' }, expect: 200 });
await call('POST', VERIFY, { body: { reference: '😀🎟️🇮🇳 पास' }, expect: 200 });
// A NUL byte used to reach PostgreSQL and answer 500 — anyone could produce a
// fault on the product's front door at will. Refused at the route wrapper now,
// before authentication, a schema or a query. See `lib/api.test.ts`.
await call('POST', VERIFY, {
  body: { reference: String.fromCharCode(0) + String.fromCharCode(1) + 'nul' },
  expect: 400,
});
await call('POST', VERIFY, { body: { reference: '   spaced   ' }, expect: 200 });

// ── size ──
await call('POST', VERIFY, {
  raw: JSON.stringify({ reference: 'a'.repeat(300_000) }),
  expect: 413,
});

// ── methods a route does not implement ──
await call('GET', VERIFY, { expect: 405 });
await call('DELETE', VERIFY, { expect: 405 });

// ── authentication ──
await call('GET', '/api/me', { expect: 401 });
await call('GET', '/api/me', { as: 'nobody@example.test', expect: 401 });
await call('GET', '/api/me/sessions', { expect: 401 });
await call('GET', '/api/me', { as: 'meera@example.in', expect: 200 });

// A session cookie that is the right shape and not a session.
await call('GET', '/api/me', { headers: { cookie: 'onepass_session=' + 'a'.repeat(64) }, expect: 401 });

// ── the palette's search: free text, over five tables, scoped to one person ──
await call('GET', '/api/me/search?q=matinee', { expect: 401 });
await call('GET', '/api/me/search?q=matinee', { as: 'nobody@example.test', expect: 401 });
await call('GET', '/api/me/search?q=a', { as: 'meera@example.in', expect: 422 });
await call('GET', '/api/me/search', { as: 'meera@example.in', expect: 422 });
// A LIKE wildcard is text here, not a pattern: unescaped, `%` would turn a
// search box into an export of everything the caller owns.
await call('GET', '/api/me/search?q=%25%25', { as: 'meera@example.in', expect: 200 });
await call('GET', '/api/me/search?q=' + encodeURIComponent("' or 1=1 --"), {
  as: 'meera@example.in',
  expect: 200,
});
await call('GET', '/api/me/search?q=' + 'x'.repeat(500), { as: 'meera@example.in', expect: 422 });
await call('POST', '/api/me/search?q=matinee', { as: 'meera@example.in', expect: 405 });

// ── cross-tenant: the same answer as "does not exist" ──
const OTHER_ORG = '01M1V4A8SVH1553KWSWA0X2B5V';
await call('GET', `/api/partner/${OTHER_ORG}/api-keys`, { as: 'meera@example.in', expect: 404 });
await call('GET', `/api/partner/${OTHER_ORG}/credentials`, { as: 'meera@example.in', expect: 404 });
await call('GET', '/api/partner/01NOTAREALORGANIZATION00/api-keys', {
  as: 'owner@phoenix-cinemas.example',
  expect: 404,
});
await call('GET', '/api/partner/not-a-ulid/api-keys', {
  as: 'owner@phoenix-cinemas.example',
  expect: 404,
});

// ── the counter: the two calls that decide whose account a sale lands on ──
//
// These write a warranty the shop owes and transfer ownership of goods, so they
// are worth throwing rubbish at specifically. A consumer is not staff anywhere,
// and an outsider's organization must answer 404 rather than 403 — a refusal
// would confirm the organization is real.
const HOTEL = '01M2YVGJ803GKBA4JCYWQ4HX0X';
await call('POST', `/api/partner/${HOTEL}/pass/verify`, {
  expect: 401,
  body: { token: 'OP1|px_notreal99|000000|1' },
});
await call('POST', `/api/partner/${HOTEL}/pass/verify`, {
  as: 'meera@example.in',
  expect: 404,
  body: { token: 'OP1|px_notreal99|000000|1' },
});
await call('POST', `/api/partner/${HOTEL}/pass/verify`, {
  as: 'desk@grand-sahyadri.example',
  expect: 422,
  body: { token: 'OP1|px_notreal99|000000|1', somethingElse: true },
});
// Well-formed on purpose: the body schema runs before the handler authorizes, so
// a malformed body would be answered by the validator and tell us nothing about
// who is allowed in.
const SALE = {
  presentationId: '01JB7QB4W8N2S9Y5R0M4C1D7HE',
  returnWindowDays: 0,
  lines: [{ description: 'x', quantity: 1, unitPriceMinor: 1, taxRateBp: 0 }],
};
await call('POST', `/api/partner/${HOTEL}/receipts`, { expect: 401, body: SALE });
await call('POST', `/api/partner/${HOTEL}/receipts`, { as: 'meera@example.in', expect: 404, body: SALE });
// A caller naming the buyer is a 422, not a field quietly dropped.
await call('POST', `/api/partner/${HOTEL}/receipts`, {
  as: 'desk@grand-sahyadri.example',
  expect: 422,
  body: {
    presentationId: '01JB7QB4W8N2S9Y5R0M4C1D7HE',
    userId: '01M2YVGJ803GKBA4JCYWQ4HX0X',
    returnWindowDays: 0,
    lines: [{ description: 'x', quantity: 1, unitPriceMinor: 1, taxRateBp: 0 }],
  },
});
// A price that is not a whole number of paise is refused rather than rounded.
await call('POST', `/api/partner/${HOTEL}/receipts`, {
  as: 'desk@grand-sahyadri.example',
  expect: 422,
  body: {
    presentationId: '01JB7QB4W8N2S9Y5R0M4C1D7HE',
    returnWindowDays: 0,
    lines: [{ description: 'x', quantity: 1, unitPriceMinor: 10.5, taxRateBp: 0 }],
  },
});

// ── ticket transfer: the code is the credential, so probe it ──
//
// Claiming is the side an attacker would guess from. What makes guessing
// hopeless is 80 bits of code from an alphabet with no look-alikes; what these
// check is that the endpoint does not help — same answer for a code that never
// existed as for one already used, no user enumeration, and a shape check
// before any of it.
await call('POST', '/api/me/ticket-transfers/claim', {
  expect: 401,
  body: { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' },
});
await call('POST', '/api/me/ticket-transfers/claim', {
  as: 'meera@example.in',
  expect: 404,
  body: { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' },
});
await call('POST', '/api/me/ticket-transfers/claim', {
  as: 'meera@example.in',
  expect: 422,
  body: { code: '../../etc/passwd' },
});
await call('POST', '/api/me/ticket-transfers/claim', {
  as: 'meera@example.in',
  expect: 422,
  body: { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', userId: '01M2YVGJ803GKBA4JCYWQ4HX0X' },
});
// Offering somebody else's ticket is not found, not refused.
await call('POST', '/api/me/tickets/tkt_definitely_not_real/transfer', {
  as: 'meera@example.in',
  expect: [401, 404],
});

// ── CSRF: a write with no Origin is refused ──
await call('POST', '/api/auth/sign-in', {
  body: { identifier: 'meera@example.in', password: 'whatever' },
  headers: { origin: 'https://evil.example' },
  expect: 400,
});

// ── the public credential GET ──
await call('GET', '/api/v1/credentials/cred_definitely_not_real', { expect: 200 });
await call('GET', '/api/v1/credentials/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd', { expect: 200 });

// ── health and readiness ──
await call('GET', '/api/health', { expect: 200 });
await call('GET', '/api/ready', { expect: 200 });

// ── the stream refuses an anonymous caller ──
await call('GET', '/api/events/stream', { expect: 401 });

// ── rate limiting actually engages ──
{
  const label = 'rate limit on POST /api/v1/verify';
  let limited = false;
  let sawHeaders = false;
  for (let i = 0; i < 140; i += 1) {
    const res = await fetch(baseUrl + VERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ reference: `cred_burst_${i}` }),
    });
    if (res.headers.get('ratelimit-limit')) sawHeaders = true;
    if (res.status === 429) {
      limited = true;
      if (!res.headers.get('retry-after')) fail(label, '429 with no Retry-After');
      break;
    }
  }
  if (!sawHeaders) fail(label, 'no RateLimit-* headers on any response');
  if (!limited) fail(label, 'never refused after 140 requests in a burst');
  else passed.push(label);
}

/* ─────────────────────────  report  ───────────────────────── */

console.log(`${passed.length} check(s) as expected, ${findings.length} finding(s)\n`);
for (const f of findings) console.log(`  ✗ ${f.what}\n      ${f.detail}\n`);
process.exit(findings.length === 0 ? 0 : 1);
