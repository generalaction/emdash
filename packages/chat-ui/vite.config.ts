import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
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
    // Run parity tests in node environment (no DOM needed — pure arithmetic).
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // CSS modules aren't available in node; stub them.
    css: false,
  },
});
