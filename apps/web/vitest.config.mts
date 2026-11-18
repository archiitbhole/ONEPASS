import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `.mts` is ESM, where `__dirname` does not exist.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Integration tests share one Postgres database, so they run in a single
    // process. Parallel files would interleave truncations and produce failures
    // that look like bugs but are test infrastructure.
    //
    // `fileParallelism: false` is the Vitest 4+ spelling of what used to be
    // `poolOptions.forks.singleFork`. That option was *removed*, not renamed, so
    // on the upgrade it was being ignored — and an ignored option here does not
    // fail, it silently lets the files run in parallel against one database.
    // Setting this also pins `maxWorkers` to 1, which is the guarantee the
    // paragraph above is actually asking for.
    environment: 'node',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['src/**/*.test.ts'],
  },
  resolve: { alias: { '@': path.resolve(here, 'src') } },
});
