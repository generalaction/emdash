import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), solid()],
  css: {
    modules: {
      // Keep the original kebab class names (e.g. 'pchat-transcript') as keys in
      // addition to camelCase aliases. Components look classes up by their kebab
      // names (styles['pchat-row']); 'camelCaseOnly' would strip those keys and
      // every chat class would render as the string "undefined".
      localsConvention: 'camelCase',
    },
  },
  test: {
    projects: [
      {
        // Parity / arithmetic tests — pure Node, no DOM needed.
        // Benchmarks are excluded here because measure.bench.ts imports from
        // REGISTRY which transitively uses solid-js/web (browser-only).
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          css: false,
        },
        benchmark: {
          include: [],
        },
      },
      {
        // Measurement contract tests and benchmarks — need real browser layout.
        // Benchmarks live here (not in node) because measure.bench.ts imports
        // from REGISTRY which transitively uses solid-js/web.
        extends: true,
        test: {
          name: 'browser',
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          include: ['src/**/*.contract.test.tsx'],
          setupFiles: ['src/tests/contract-setup.ts'],
        },
        benchmark: {
          include: ['src/**/*.bench.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        // Performance + memory tests — informational only, excluded from `pnpm test`.
        // Run with `pnpm --filter @emdash/chat-ui run test:perf`.
        extends: true,
        test: {
          name: 'perf',
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          include: ['src/tests/perf/**/*.perf.test.tsx'],
          setupFiles: ['src/tests/contract-setup.ts'],
        },
      },
    ],
  },
});
