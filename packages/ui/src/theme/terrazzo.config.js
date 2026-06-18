import { defineConfig } from '@terrazzo/cli';
import css from '@terrazzo/plugin-css';
import js from '@terrazzo/plugin-js';

// Strip the top-level group prefix so token IDs map to plain CSS variable names:
//   color.neutral.1    →  --neutral-1
//   surface.base-hover →  --surface-base-hover
//   semantic.foreground →  --foreground
const variableName = (token) =>
  '--' + token.id.replace(/^(color|semantic)\./, '').replace(/\./g, '-');

const modeSelectors = [
  { mode: 'light', selectors: ['.emlight'] },
  { mode: 'dark', selectors: ['.emdark'] },
];

// Token groups that live in primitives.generated.json (not semantic.tokens.json)
const PRIMITIVE_GROUPS = [
  'color.**',
  'surface.**',
  'typography.**',
  'type.**',
  'radius.**',
  'fade.**',
];

export default defineConfig({
  tokens: ['./primitives.generated.json', './semantic.tokens.json'],
  outDir: './',
  plugins: [
    // Primitive palette + surface + type + radius tokens → theme.css
    css({
      filename: 'theme.css',
      exclude: ['semantic.**'],
      variableName,
      modeSelectors,
    }),

    // Semantic alias template → semantic.css
    css({
      filename: 'semantic.css',
      exclude: PRIMITIVE_GROUPS,
      variableName,
      modeSelectors,
      transform(token, mode) {
        // foreground-body is computed via color-mix so Tailwind/CSS can adapt
        // it to whatever the resolved --neutral-11/12 values are in each mode.
        if (token.id === 'semantic.foreground-body') {
          return 'color-mix(in srgb, var(--neutral-11) 40%, var(--neutral-12))';
        }
        // primary-button-border is transparent in light mode (light UI convention).
        if (token.id === 'semantic.primary-button-border' && mode === 'light') {
          return 'transparent';
        }
      },
    }),

    // JavaScript token map for metrics.ts / runtime token access
    js({
      js: 'tokens.js',
    }),
  ],
});
