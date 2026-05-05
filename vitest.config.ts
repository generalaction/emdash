import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
const alias = {
  '@': resolve(__dirname, 'src'),
  '@root': resolve(__dirname, '.'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@main': resolve(__dirname, 'src/main')
};
export default defineConfig({
  resolve: {
    alias
  },
  test: {
    projects: [{
      // All existing tests that run in a Node.js environment.
      extends: true,
      test: {
        name: 'node',
        environment: 'node',
        include: ['src/**/*.test.ts'],
        exclude: ['**/_*/**', 'src/renderer/tests/browser/**']
      }
    }, {
      // Renderer terminal tests that need a real browser environment
      // (real CSS layout, ResizeObserver, requestAnimationFrame, WebGL).
      extends: true,
      test: {
        name: 'browser',
        browser: {
          enabled: true,
          provider: playwright(),
          headless: true,
          instances: [{
            browser: 'chromium'
          }]
        },
        include: ['src/renderer/tests/browser/**/*.test.{ts,tsx}']
      }
    }, {
      extends: true,
      plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      test: {
        name: 'storybook',
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          instances: [{
            browser: 'chromium'
          }]
        }
      }
    }]
  }
});