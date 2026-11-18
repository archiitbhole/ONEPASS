#!/usr/bin/env bash
# Typecheck, lint and unit-test in one pass, so a validation run is one command
# rather than three that can be half-done.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

# npm hoists to the workspace root, so the binaries are two levels up.
BIN="../../node_modules/.bin"

echo "=== typecheck ==="
if "$BIN/tsc" --noEmit; then echo "clean"; else fail=1; fi

echo
echo "=== lint ==="
if "$BIN/eslint" . ; then echo "clean"; else fail=1; fi

echo
echo "=== unit and integration tests ==="
# The app logs JSON to stdout; strip it so a failure is readable.
"$BIN/vitest" run --reporter=dot > /tmp/vitest-out.txt 2>&1 || fail=1
grep -vE '^\{"level"' /tmp/vitest-out.txt | tail -25

echo
echo "=== browser tests ==="
# Deliberately not run here, and this note is the reason.
#
# The browser suite must run against a PRODUCTION BUILD, not `next dev`. The
# CSP is nonce-based, and dev renders every page per request so the nonce always
# matches — which hid a bug that left several pages with no JavaScript at all in
# production. A suite pointed at a dev server cannot see a policy failure.
#
#   npm run build
#   PORT=4000 SMOKE_APP_URL=https://localhost:4000 ./scripts/smoke-prod.sh &
#   E2E_BASE_URL=http://localhost:4000 npx playwright test
#
echo "skipped — run against a built server; see the note in this script"

echo
echo "validate exit=$fail"
exit "$fail"
