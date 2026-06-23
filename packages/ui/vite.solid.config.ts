import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';

const root = resolve(__dirname, 'src');
import dts from 'vite-plugin-dts';
import solid from 'vite-plugin-solid';

// Solid lib build — separate from the React pipeline because the JSX transforms
// (solid-js vs react-jsx) are incompatible. VE is shared; solid-js is external.
export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      '@react': resolve(root, 'react'),
      '@solid': resolve(root, 'solid'),
      '@styles': resolve(root, 'styles'),
      '@theme': resolve(root, 'theme'),
    },
  },
  plugins: [
    solid(),
    vanillaExtractPlugin(),
    dts({
      tsconfigPath: './tsconfig.solid.json',
      outDirs: 'dist',
      include: ['src/solid'],
    }),
  ],
  build: {
    lib: {
      entry: {
        solid: resolve(__dirname, 'src/solid/index.ts'),
        'solid/components': resolve(__dirname, 'src/solid/components/index.ts'),
      },
      formats: ['es'],
    },
    outDir: 'dist',
    rollupOptions: {
      external: ['solid-js', 'solid-js/web', 'solid-js/store'],
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.some((n) => n.endsWith('.css'))) return 'solid-style.css';
          return '[name][extname]';
        },
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
});
