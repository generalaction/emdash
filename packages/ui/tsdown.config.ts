import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    primitives: 'src/primitives/index.ts',
    components: 'src/components/index.ts',
    patterns: 'src/patterns/index.ts',
    'recipes/control': 'src/recipes/control.ts',
    'recipes/input': 'src/recipes/input.ts',
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
      '@tiptap/core',
      '@tiptap/extension-mention',
      '@tiptap/extension-placeholder',
      '@tiptap/pm',
      '@tiptap/react',
      '@tiptap/starter-kit',
      '@tiptap/suggestion',
    ],
  },
  sourcemap: true,
  clean: true,
});
