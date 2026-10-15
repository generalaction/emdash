// Bundles the clipboard smoke, which imports production main-process modules, and runs it in
// the app's Electron: `node tooling/native-clipboard/run.mjs` (Linux needs a display, e.g.
// `xvfb-run -a`). ELECTRON_OVERRIDE_DIST_PATH selects another Electron 40 build.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { build } from 'esbuild';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outfile = join(appRoot, 'out', 'native-clipboard', 'clipboard-smoke.mjs');

await build({
  entryPoints: [join(appRoot, 'tooling', 'native-clipboard', 'clipboard-smoke.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['electron'],
  tsconfig: join(appRoot, 'tsconfig.json'),
  logLevel: 'warning',
});

const args = process.platform === 'linux' ? ['--no-sandbox', outfile] : [outfile];
const result = spawnSync(electron, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
