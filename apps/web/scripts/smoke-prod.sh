#!/usr/bin/env bash
# Boot the built standalone bundle in production mode against local services.
#
# The values below are placeholders that exist only to satisfy the production
# env guard so the compiled bundle can be exercised locally. They are not
# credentials, nothing is sent with them, and this script is not a deployment.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
source .env
set +a

export NODE_ENV=production
export PORT="${PORT:-3000}"
# Overridable with SMOKE_APP_URL, not with APP_URL: `.env` was sourced a few
# lines above with `set -a`, so a `${APP_URL:-…}` default would silently defer
# to the development value and the production env guard would refuse to boot.
# The override exists because the developer reference builds its curl examples
# from this value, and an example that says smoke.local teaches nothing. It must
# still be https — the guard refuses anything else, deliberately.
export APP_URL="${SMOKE_APP_URL:-https://smoke.local}"
export HASH_PEPPER="0123456789abcdef0123456789abcdef"
export PAYMENT_PROVIDER=RAZORPAY
export RAZORPAY_KEY_ID="rzp_smoke_placeholder"
export RAZORPAY_KEY_SECRET="smoke_placeholder"
export RAZORPAY_WEBHOOK_SECRET="smoke_placeholder"
export EMAIL_PROVIDER=RESEND
export RESEND_API_KEY="re_smoke_placeholder"
export SMS_PROVIDER=MSG91
export MSG91_AUTH_KEY="smoke_placeholder"

# The sample flight source is refused in production, and this boots in
# production mode. `.env` turns it on for development, and the `set -a` above
# would otherwise carry that value in — at which point the guard would, quite
# correctly, refuse to start.
#
# The consequence is worth stating rather than discovering: a smoke run has no
# flight source at all, so /travel says so plainly and returns no fares. That is
# exactly right for a production-shaped process, and it is why
# `e2e/travel.spec.ts` is the one suite that cannot run here — it needs the
# sample source, and so it runs against `next dev` instead.
export TRAVEL_SAMPLE_PROVIDER=false

exec node .next/standalone/apps/web/server.js
