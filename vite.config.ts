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
    // Allow overriding with env VITE_PORT; default 3000. Keep strict to avoid port drift from Electron.
    port: Number(process.env.VITE_PORT || process.env.PORT || '3000'),
    strictPort: true,
  },
}));
