import { defineConfig } from '@terrazzo/cli';
import css from '@terrazzo/plugin-css';

export default defineConfig({
  tokens: ['./tokens.generated.json'],
  outDir: './',
  plugins: [
    css({
      filename: 'theme.css',
      // Strip the top-level group prefix so token IDs map directly to CSS variable names:
      //   color.neutral.1  →  --neutral-1
      //   surface.app-hover  →  --surface-app-hover
      variableName: (token) =>
        '--' + token.id.replace(/^(color|semantic)\./, '').replace(/\./g, '-'),
      modeSelectors: [
        { mode: 'light', selectors: ['.emlight'] },
        { mode: 'dark', selectors: ['.emdark'] },
      ],
    }),
  ],
});
