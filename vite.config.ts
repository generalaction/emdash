import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const alias = {
  '@': resolve(__dirname, './src/renderer'),
  '@shared': resolve(__dirname, './src/shared'),
  '#types': resolve(__dirname, './src/types'),
};

export default defineConfig(({ command }) => ({
  // Use relative asset paths in production so file:// loads work from DMG/app bundle
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  root: './src/renderer',
  test: {
    projects: [
      {
        test: {
          name: 'node',
          dir: '.',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
        resolve: { alias },
      },
      {
        plugins: [react()],
        test: {
          name: 'jsdom',
          dir: '.',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: [resolve(__dirname, 'src/test/setup.ts')],
        },
        resolve: { alias },
      },
    ],
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: { alias },
  server: {
    port: Number(process.env.EMDASH_DEV_PORT) || 3000,
  },
}));
