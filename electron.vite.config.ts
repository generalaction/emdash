import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/main'),
      },
    },
  },
  preload: {},
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '#types': resolve('src/types'),
      },
    },
    server: {
      port: 3000,
    },
  },
});
