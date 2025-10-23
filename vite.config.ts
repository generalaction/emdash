import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ command }) => ({
  // Use relative asset paths in production so file:// loads work from DMG/app bundle
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  root: './src/renderer',
  test: {
    dir: '.',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src/renderer'),
      '#types': resolve(__dirname, './src/types'),
    },
  },
  server: {
    port: 3000,
  },
}));
