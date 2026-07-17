import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: ['es2022', 'safari15'],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
