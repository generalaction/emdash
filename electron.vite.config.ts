import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    root: 'src/main',
    envDir: resolve('.'),
    resolve: {
      alias: {
        '@': resolve('src'),
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
    build: {
      rollupOptions: {
        // Second entry: the usage-stats utilityProcess worker, emitted alongside index.js
        // so the main process can fork it via join(__dirname, 'usage-worker.js').
        input: {
          index: resolve('src/main/index.ts'),
          'usage-worker': resolve('src/main/core/usage-stats/usage-worker.ts'),
        },
      },
    },
  },
  preload: {
    root: 'src/preload',
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve('src'),
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@root': resolve('.'),
      },
    },
    server: {
      port: 3000,
    },
  },
});
