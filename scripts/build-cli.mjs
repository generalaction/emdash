#!/usr/bin/env node
/**
 * Bundles the emdash CLI (src/main/cli/index.ts) into a single CommonJS file at
 * out/cli/index.cjs.
 *
 * Why CJS (and not the electron-vite ESM main build): the CLI runs under
 * ELECTRON_RUN_AS_NODE so its better-sqlite3 native ABI matches the desktop
 * build. In that mode the `electron` module is a plain CJS stub, so an ESM
 * `import { app } from 'electron'` fails at instantiation. CJS `require('electron')`
 * just yields `undefined` for those names, which is fine because every electron
 * API use in the CLI's import graph is lazy/guarded and EMDASH_DB_FILE is set
 * by the launcher before the bundle loads.
 *
 * All node_modules stay external (resolved at runtime from the repo), mirroring
 * how electron-vite externalizes the main process.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (p) => path.join(root, p);

await build({
  entryPoints: [r('src/main/cli/index.ts')],
  outfile: r('out/cli/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Keep all third-party packages (and native addons) external; bundle only our source.
  packages: 'external',
  external: ['electron'],
  // Vite-only globals that don't exist under CJS/Node. The CLI doesn't rely on
  // build-time env (it sets EMDASH_DB_FILE explicitly), so an empty object is safe.
  define: {
    'import.meta.env': '{}',
  },
  alias: {
    '@': r('src'),
    '@main': r('src/main'),
    '@shared': r('src/shared'),
    '@renderer': r('src/renderer'),
    '@root': root,
    '@tooling': r('tooling'),
  },
  logLevel: 'info',
});
