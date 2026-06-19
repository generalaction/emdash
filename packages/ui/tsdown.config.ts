import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'clsx',
      'tailwind-merge',
      '@base-ui/react',
      'lucide-react',
      'class-variance-authority',
    ],
  },
  sourcemap: true,
  clean: true,
});
