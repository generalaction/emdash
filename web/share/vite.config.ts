import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The desktop app expects the share worker on :8787 in dev (see src/main/core/share/config.ts).
  server: { port: 8787, strictPort: true },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
