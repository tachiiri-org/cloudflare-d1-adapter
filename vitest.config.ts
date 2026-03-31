/// <reference types="vitest" />

import { defineConfig } from 'vitest/config';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    globalTeardown: 'tests/helpers/global-teardown.ts'
  },
  projects: [
    defineWorkersConfig({
      name: 'worker',
      test: {
        include: ['**/__tests__/**/*.test.ts', '**/tests/**/*.test.ts'],
        fileParallelism: false,
        poolOptions: {
          workers: {
            wrangler: {
              configPath: './wrangler.toml'
            }
          }
        }
      }
    })
  ]
});
