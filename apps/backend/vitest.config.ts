import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Each suite opens its own in-memory database; running them in one thread
    // keeps SQLite file locking out of the picture entirely.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
