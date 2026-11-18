#!/usr/bin/env bash
# Bring up the local dependencies and make sure the schema is current.
#
# Written after a container restart dropped the Postgres data directory mid-build.
# Nothing irreplaceable was lost — the schema lives in Drizzle and the sample data in
# a seed script — but only because both are reproducible. This makes that explicit:
# the database is a build artifact of this repository, not a thing to be nursed.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ postgres"
pg_isready -q || {
  rm -f /var/lib/postgresql/16/main/postmaster.pid
  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
    -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' -l /tmp/pg.log start" >/dev/null
  for _ in $(seq 30); do pg_isready -q && break; sleep 0.5; done
}
pg_isready

echo "→ redis"
redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes
redis-cli ping

# Which databases, according to .env — not according to this script.
#
# These names used to be hard-coded. That is invisibly correct as long as
# DATABASE_URL says `onepass`, and quietly broken the moment somebody changes
# it, which the README invites them to do: the script reported "→ databases"
# as done, having created two databases nobody was going to use, and then the
# schema step failed with a raw Postgres "database does not exist". Found by a
# clean-room rebuild that picked a different name to keep out of the way.
DEV_DB="$(node -e 'const u=require("node:fs").readFileSync("apps/web/.env","utf8").match(/^DATABASE_URL=(.*)$/m); process.stdout.write(u ? new URL(u[1].trim().replace(/^["\x27]|["\x27]$/g,"")).pathname.slice(1).split("?")[0] : "onepass")' 2>/dev/null || echo onepass)"
: "${DEV_DB:=onepass}"
TEST_DB="${DEV_DB}_test"

echo "→ databases"
for d in "$DEV_DB" "$TEST_DB"; do
  psql -U postgres -h localhost -lqt | cut -d'|' -f1 | grep -qw "$d" || createdb -U postgres -h localhost "$d"
done
echo "  $DEV_DB, $TEST_DB"

echo "→ test environment"
# The integration suite reads apps/web/.env.test and refuses to run unless the
# database name ends in _test, so a suite can never truncate the development
# database. Derived from .env on first run; an existing file is left alone.
#
# The substitution is on the database name this script just resolved, so it
# works whatever that name is and whether or not the value is quoted — the old
# pattern required both a literal `onepass` and a closing double quote, and
# silently left the URL alone when either was absent.
if [ -f apps/web/.env ] && [ ! -f apps/web/.env.test ]; then
  sed -E "s#(^DATABASE_URL=.*/)${DEV_DB}([\"'\?]?)\$#\\1${TEST_DB}\\2#" apps/web/.env > apps/web/.env.test
  chmod 600 apps/web/.env.test
  grep -q "/${TEST_DB}" apps/web/.env.test || {
    echo "  could not point apps/web/.env.test at ${TEST_DB} — check DATABASE_URL in apps/web/.env" >&2
    exit 1
  }
  chmod 600 apps/web/.env.test
  echo "  wrote apps/web/.env.test (same values as .env, database ${TEST_DB})"
else
  echo "  apps/web/.env.test present, or no .env to derive it from"
fi

echo "→ schema"
# Through the wrapper, never bare drizzle-kit: a bare push drops the row-level
# policies and the consent view, which the wrapper puts back and checks.
( cd apps/web && npm run db:push --silent -- --force >/dev/null && echo "  applied to $DEV_DB" )
( cd apps/web && DATABASE_URL="postgresql://postgres@localhost:5432/${TEST_DB}" \
    npm run db:push --silent -- --force >/dev/null && echo "  applied to $TEST_DB" )

echo "→ isolation (roles, grants, row-level security)"
for d in "$DEV_DB" "$TEST_DB"; do
  psql -U postgres -h localhost -d "$d" -f apps/web/src/db/isolation.sql >/dev/null 2>&1 \
    && echo "  $d: 3 roles, grants and policies applied"
done

echo "→ seed"
# Not `|| echo "(no seed yet)"`. That swallowed a genuine failure and printed a
# reassuring sentence over it — a clean-room run whose seed never executed
# still said "ready." and left every later step to fail confusingly.
( cd apps/web && npm run db:seed --silent )
# The verification pages and the browser suite read a real, active credential,
# which the main seed does not issue.
( cd apps/web && npm run db:seed:credential --silent >/dev/null && echo "  sample credential issued" )

echo "→ sample window"
# The sample data turns on "tonight" meaning tonight. Seeded on Monday and shown on
# Thursday, the headline deal ended three days ago. This re-anchors the
# forward-looking rows onto today and runs the expiry sweeps, leaving the eight
# weeks of trading history — which the advisor measures — exactly where it is.
( cd apps/web && npm run db:refresh --silent 2>/dev/null | sed 's/^/  /' || echo "  (skipped)" )

echo "ready."
