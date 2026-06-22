import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// @vitejs/plugin-react is intentionally omitted from the lib build.
// Vite's esbuild handles React JSX natively via tsconfig "jsx": "react-jsx".
// The plugin is only needed for Storybook (HMR / React Refresh).

export default defineConfig({
  plugins: [
    vanillaExtractPlugin(),
    dts({
      tsconfigPath: './tsconfig.json',
      // Emit per-entry declarations into dist/ (mirroring the src/ tree).
      // Exports in package.json reference dist/src/**/*.d.ts paths accordingly.
      // Do NOT use rollupTypes: true — we have multiple public entries.
      outDirs: 'dist',
      include: ['src'],
    }),
  ],
  build: {
    lib: {
      entry: {
        primitives: resolve(__dirname, 'src/primitives/index.ts'),
        components: resolve(__dirname, 'src/components/index.ts'),
        patterns: resolve(__dirname, 'src/patterns/index.ts'),
        'recipes/control': resolve(__dirname, 'src/recipes/control.ts'),
        'recipes/input': resolve(__dirname, 'src/recipes/input.ts'),
        // VE theme utilities — exports sx (Sprinkles) and vars (theme contract).
        // Importing this entry causes style.css to include the extracted VE atoms.
        'theme/sprinkles': resolve(__dirname, 'src/theme/sprinkles.css.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'clsx',
        'tailwind-merge',
        '@base-ui/react',
        'lucide-react',
        'class-variance-authority',
        '@tiptap/core',
        '@tiptap/extension-mention',
        '@tiptap/extension-placeholder',
        '@tiptap/pm',
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@tiptap/suggestion',
        /^@fontsource/,
      ],
      output: {
        // Rename the bundled stylesheet so consumers import '@emdash/ui/style.css'.
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.some((n) => n.endsWith('.css'))) return 'style.css';
          return '[name][extname]';
        },
      },
    },
    // Emit a single style.css containing all VE and global styles.
    cssCodeSplit: false,
    sourcemap: true,
  },
});
