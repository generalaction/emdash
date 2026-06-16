import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import dts from 'vite-plugin-dts';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [
    tailwindcss(),
    solid(),
    dts({
      rollupTypes: true,
      tsconfigPath: './tsconfig.json',
    }),
  ],
  css: {
    modules: {
      // Keep the original kebab class names (e.g. 'pchat-transcript') as keys in
      // addition to camelCase aliases. Components look classes up by their kebab
      // names (styles['pchat-row']); 'camelCaseOnly' would strip those keys and
      // every chat class would render as the string "undefined".
      localsConvention: 'camelCase',
      // Pin a deterministic scoped-name format so the JS interop object and the
      // emitted style.css always use the same class names. Without this, Vite's
      // library-mode build can produce a trailing `_<line>` suffix in the CSS
      // output that the JS references lack, causing every CSS-module rule to miss.
      generateScopedName: '[name]__[local]__[hash:base64:5]',
    },
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.tsx'),
        react: resolve(__dirname, 'src/react/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'solid-js',
        'solid-js/web',
        'solid-js/store',
        'react',
        'react-dom',
        /^@fontsource/,
      ],
      output: {
        // Rename the bundled stylesheet to style.css so consumers can import
        // '@emdash/chat-ui/style.css' without knowing the internal lib name.
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.some((n) => n.endsWith('.css'))) return 'style.css';
          return '[name][extname]';
        },
      },
    },
    // Emit a single style.css containing all CSS modules and global styles.
    cssCodeSplit: false,
  },
});
