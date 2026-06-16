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
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          css: false,
        },
      },
      {
        // Measurement contract tests — need real browser layout for offsetHeight.
        // Mirrors the desktop app's browser Vitest project setup.
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
      },
    ],
  },
});
