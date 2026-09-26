import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const desktopRoot = resolve(__dirname, '../emdash-desktop');

/**
 * Web override: the local-directory selector becomes a manual path input
 * (native OS dialogs do not exist in the browser). Rewrites imports of the
 * desktop `local-directory-selector` from the add-project modal.
 */
const localDirectorySelectorOverride = {
  name: 'emdash-web-local-directory-override',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (source.endsWith('local-directory-selector') && importer?.includes('add-project-modal')) {
      return resolve(__dirname, 'web/overrides/local-directory-selector.tsx');
    }
    return null;
  },
};

// Mirrors the desktop renderer vite config (electron.vite.config.ts → renderer)
// with the web entry as root. Aliases point into the desktop app source so the
// entire renderer — components, theme, stores — is reused unchanged.
export default defineConfig({
  root: resolve(__dirname, 'web'),
  plugins: [react(), tailwindcss(), localDirectorySelectorOverride],
  resolve: {
    alias: {
      '@': resolve(desktopRoot, 'src'),
      '@core': resolve(desktopRoot, 'src/core'),
      '@renderer': resolve(desktopRoot, 'src/renderer'),
      '@root': desktopRoot,
      '@web': resolve(__dirname, 'web'),
      'node:buffer': 'buffer',
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 8192,
  },
  server: {
    port: 4300,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:4200',
        ws: true,
      },
    },
  },
});
