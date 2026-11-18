/**
 * ESLint, flat config.
 *
 * `next lint` is deprecated and goes away in Next 16, and without a config file
 * on disk it does not fail — it drops into an interactive "how would you like to
 * configure ESLint?" prompt, which in CI or a script is a hang followed by a
 * non-zero exit that looks like a lint failure and is not one. So this calls the
 * ESLint CLI directly, which is what Next's own migration note recommends.
 *
 * `eslint-config-next` still ships as an eslintrc-style shareable config, so it
 * is brought across with FlatCompat rather than imported directly.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // The codebase uses `catch {}` deliberately in a few places where the only
      // correct response to a failure is to carry on — closing a stream that is
      // already closed, dropping a malformed frame. Those are commented at each
      // site; an empty block is not on its own a defect.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];

export default config;
