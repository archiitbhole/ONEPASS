import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A self-contained server bundle under .next/standalone, so the runtime image
  // carries the traced node_modules it actually needs instead of the whole
  // workspace. Required by the Dockerfile at the repository root.
  output: 'standalone',
  // This is a workspace: @onepass/pass lives at ../../packages/pass and is
  // resolved through the root node_modules. Without a tracing root at the
  // repository root, Next traces from apps/web and the standalone bundle is
  // missing every hoisted dependency.
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../..'),
  // Argon2 and the postgres driver are native/node-only; keep them out of the bundle.
  serverExternalPackages: ['@node-rs/argon2', 'postgres', 'ioredis'],
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};
export default nextConfig;
