# ONEPASS — production container image.
#
# Five stages, and the split is the point:
#
#   deps     npm ci against the committed lockfile, nothing else. Cached until a
#            package.json or the lockfile changes, which is most of the build time.
#   source   the working tree plus @onepass/pass compiled. The web app imports it
#            and nothing typechecks or builds until dist/ exists.
#   build    `next build` with output: 'standalone'.
#   runtime  the shipped image: the traced server bundle, a non-root user, and
#            nothing else. No compiler, no source, no dev dependencies, no npm.
#   tools    schema push, seed and maintenance commands — the same npm scripts
#            scripts/bootstrap-dev.sh runs. Never the thing serving traffic.
#
# NO SECRET IS BAKED IN. There is no ENV line here carrying a credential and no
# ARG that could become one: every secret — the encryption key, the hash pepper,
# the database URL, the payment and delivery provider keys — arrives at runtime
# from the environment, and src/lib/env.ts refuses to serve a request without it.
# The one key-shaped value below is generated inside the build layer, is used to
# satisfy a schema check while Next collects page data, seals nothing, and never
# reaches the runtime stage.
#
# Build:  docker build -t onepass:local .
# Run:    docker run --rm -p 3000:3000 --env-file .env onepass:local

# ─────────────────────────────────────────────────────────────
# base
#
# Pinned to a patch version rather than a floating `22-alpine`, so two builds a
# month apart are the same base. Pinning by digest is stronger still — resolve
# one and replace the tag when you have registry access:
#
#   docker buildx imagetools inspect node:22.22.2-alpine --format '{{.Manifest.Digest}}'
#   FROM node:22.22.2-alpine@sha256:<digest> AS base
#
# Alpine (musl) is deliberate and paired with the note in `deps` below.
# ─────────────────────────────────────────────────────────────
FROM node:22.22.2-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

# ─────────────────────────────────────────────────────────────
# deps — the dependency layer.
#
# @node-rs/argon2 is a napi-rs (Rust) native module: node-gyp cannot build it, so
# a working binary comes from one of its prebuilt platform packages. The lockfile
# pins @node-rs/argon2-linux-x64-musl and -linux-arm64-musl, which is what npm
# resolves on this musl base — hence alpine here rather than a glibc image with
# alpine at runtime, where the wrong binary would be traced into the bundle.
#
# python3/make/g++ are here for the node-gyp addons elsewhere in the tree, so a
# missing prebuild fails as a compile rather than as a mystery at runtime. They
# exist only in this stage; the runtime image has no compiler.
#
# The probe at the end is the guarantee: if the native binding does not load and
# hash, the build stops here rather than shipping an image that cannot verify a
# password.
# ─────────────────────────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache python3 make g++ libstdc++

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/pass/package.json packages/pass/package.json

RUN npm ci --include=optional
RUN node -e "const a=require('@node-rs/argon2'); const h=a.hashSync('probe'); if(!a.verifySync(h,'probe')) process.exit(1); console.log('argon2 native binding loads and verifies')"

# ─────────────────────────────────────────────────────────────
# source — working tree + the compiled workspace package.
#
# @onepass/pass resolves to packages/pass/dist, which is gitignored and therefore
# absent from the build context. Compiling it here is what makes the web app
# typecheck and build; CI does the same thing for the same reason.
# ─────────────────────────────────────────────────────────────
FROM deps AS source
COPY . .
RUN npm run build -w @onepass/pass

# ─────────────────────────────────────────────────────────────
# build — the production Next build.
#
# The three values below are placeholders required by the zod schema in
# src/lib/env.ts while Next evaluates the module graph to collect page data.
# None of them is a credential:
#
#   · the database URL points at a host that does not exist and is never dialled;
#     the build opens no connection (see the comment in src/db/client.ts).
#   · APP_URL is the local default.
#   · ENCRYPTION_KEY is 32 random bytes generated in this layer, discarded with
#     it, and used to seal nothing. It exists because the schema requires the
#     variable to be base64 for exactly 32 bytes.
#
# env.ts skips its production checks under NEXT_PHASE=phase-production-build,
# which Next sets — that is why a build needs no payment or delivery keys. Those
# same checks are enforced for real on the first request at runtime.
# ─────────────────────────────────────────────────────────────
FROM source AS build
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build-time-placeholder" \
    DIRECT_DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build-time-placeholder" \
    APP_URL="http://localhost:3000" \
    ENCRYPTION_KEY="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")" \
    npm run build -w @onepass/web

# ─────────────────────────────────────────────────────────────
# runtime — what actually ships.
#
# `output: 'standalone'` (apps/web/next.config.mjs) traces the server bundle and
# only the node_modules it reaches, so this image carries neither the workspace
# nor the dev dependencies. outputFileTracingRoot is the repository root, so the
# traced tree keeps its workspace shape: node_modules and packages/ at the top,
# the server at apps/web/server.js.
#
# Static assets and public/ are not part of the trace and are copied separately —
# without them the app serves HTML with no CSS.
# ─────────────────────────────────────────────────────────────
FROM base AS runtime

# Non-secret runtime defaults. HOSTNAME=0.0.0.0 is required: the standalone
# server binds 127.0.0.1 on some hosts otherwise and nothing outside the
# container can reach it.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

# The traced bundle must carry a loadable argon2 binary, not just the JS wrapper.
# Checked here, in the final image, rather than assumed from the deps stage.
RUN node -e "const a=require('/app/node_modules/@node-rs/argon2'); const h=a.hashSync('probe'); if(!a.verifySync(h,'probe')) process.exit(1); console.log('argon2 native binding present in runtime image')"

# `node` (uid 1000) ships with the base image. Nothing above runs as this user,
# so the application cannot modify its own code.
USER node

EXPOSE 3000

# /api/health — the real liveness endpoint. It touches no database and no Redis
# by design (see apps/web/src/app/api/health/route.ts): a liveness probe that
# depends on Postgres turns one slow query into a rolling restart. Readiness,
# which does check dependencies, is /api/ready and belongs to the load balancer,
# not to the container runtime.
#
# A container whose environment is incomplete fails this check: env.ts throws on
# the first request and /api/health returns 500. That is intended — an instance
# that cannot read its own configuration must not be marked healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "apps/web/server.js"]

# ─────────────────────────────────────────────────────────────
# tools — schema, seed and maintenance.
#
# drizzle-kit and tsx are dev dependencies and are deliberately absent from the
# runtime image, so the commands that change a database live in their own image
# and are run on purpose:
#
#   docker compose --profile tools run --rm tools npm run db:push -- --force
#   docker compose --profile tools run --rm tools npm run db:seed
#   docker compose --profile tools run --rm tools npm run db:refresh
#
# Runs as root because it writes drizzle metadata; it is never exposed and never
# serves traffic.
# ─────────────────────────────────────────────────────────────
FROM source AS tools
WORKDIR /repo/apps/web
CMD ["node", "--version"]

# ─────────────────────────────────────────────────────────────
# dev — the local full-stack target used by docker-compose.yml.
#
# `next dev`, not the production server, and that is not a shortcut. The
# standalone server generated by `next build` sets process.env.NODE_ENV to
# 'production' on its first line, unconditionally — so the production guard in
# env.ts always applies to the runtime image above, and a local stack running it
# would be refused for using the sandbox payment provider and console delivery.
# Those refusals are correct. The dev target is how you get a full stack on a
# laptop without pretending to have live provider credentials.
#
# Root, not `node`: next dev writes into /repo/apps/web/.next. This image is for
# a developer's machine and is not the one to deploy.
# ─────────────────────────────────────────────────────────────
FROM source AS dev
ENV NODE_ENV=development
WORKDIR /repo/apps/web
EXPOSE 3000
# -H 0.0.0.0 explicitly: Docker sets HOSTNAME to the container id, and a dev
# server that inherits it binds to a name nothing can resolve.
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
