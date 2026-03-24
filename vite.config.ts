import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve, sep } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const RUNANYWHERE_SHERPA_SOURCE_DIR = resolve(
  __dirname,
  './node_modules/@runanywhere/web-onnx/wasm/sherpa'
);
const RUNANYWHERE_SHERPA_ROUTE = '/assets/sherpa/';

const CROSS_ORIGIN_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

function getContentType(filePath: string) {
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  return 'application/octet-stream';
}

function isPathInside(parent: string, child: string) {
  const parentPath = `${resolve(parent)}${sep}`;
  return resolve(child).startsWith(parentPath);
}

function copyDirectory(source: string, destination: string) {
  mkdirSync(destination, { recursive: true });

  for (const entry of readdirSync(source)) {
    const sourcePath = join(source, entry);
    const destinationPath = join(destination, entry);
    const stats = statSync(sourcePath);
    if (stats.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
      continue;
    }
    copyFileSync(sourcePath, destinationPath);
  }
}

function runAnywhereOnnxAssetsPlugin(): Plugin {
  return {
    name: 'runanywhere-onnx-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = req.url?.split('?')[0] ?? '';
        if (!requestPath.startsWith(RUNANYWHERE_SHERPA_ROUTE)) {
          next();
          return;
        }

        const relativePath = requestPath.slice(RUNANYWHERE_SHERPA_ROUTE.length);
        const filePath = resolve(RUNANYWHERE_SHERPA_SOURCE_DIR, relativePath);
        if (!isPathInside(RUNANYWHERE_SHERPA_SOURCE_DIR, filePath) || !existsSync(filePath)) {
          next();
          return;
        }

        res.statusCode = 200;
        for (const [header, value] of Object.entries(CROSS_ORIGIN_HEADERS)) {
          res.setHeader(header, value);
        }
        res.setHeader('Content-Type', getContentType(filePath));
        const stream = createReadStream(filePath);
        stream.on('error', (err) => {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end();
          }
          console.error('[runanywhere-onnx-assets] stream error:', err);
        });
        stream.pipe(res);
      });
    },
    writeBundle(options) {
      const outputDir =
        typeof options.dir === 'string' ? options.dir : resolve(__dirname, './dist/renderer');
      const destinationDir = join(outputDir, 'assets', 'sherpa');
      copyDirectory(RUNANYWHERE_SHERPA_SOURCE_DIR, destinationDir);
    },
  };
}

export default defineConfig(({ command }) => ({
  // Use relative asset paths in production so file:// loads work from DMG/app bundle
  base: command === 'build' ? './' : '/',
  plugins: [react(), runAnywhereOnnxAssetsPlugin()],
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
      '@shared': resolve(__dirname, './src/shared'),
      '#types': resolve(__dirname, './src/types'),
    },
  },
  server: {
    headers: CROSS_ORIGIN_HEADERS,
    port: 3000,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@runanywhere/web', '@runanywhere/web-onnx'],
  },
  assetsInclude: ['**/*.wasm'],
}));
