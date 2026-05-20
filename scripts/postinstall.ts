import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Install the isolated better-sqlite3 for system Node unconditionally.
// Vitest fixture and migration projects alias better-sqlite3 to this copy so
// the root node_modules/better-sqlite3 can stay Electron-compiled at all times.
const toolingInstall = spawnSync('npm', ['install', '--prefix', 'tooling/node-deps'], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  shell: process.platform === 'win32',
});
if (toolingInstall.error) {
  console.error(
    'postinstall: failed to run npm install for tooling/node-deps:',
    toolingInstall.error
  );
  process.exit(1);
}
if (typeof toolingInstall.status === 'number' && toolingInstall.status !== 0) {
  process.exit(toolingInstall.status);
}

if (process.env.CI || process.env.EMDASH_SKIP_ELECTRON_REBUILD === '1') {
  process.exit(0);
}

function getElectronRebuildBin() {
  const binName = process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild';

  return path.resolve(__dirname, '..', 'node_modules', '.bin', binName);
}

function runElectronRebuild(onlyModules) {
  const electronRebuildBin = getElectronRebuildBin();
  const args = ['-f'];

  if (onlyModules && onlyModules.length > 0) {
    args.push('--only', onlyModules.join(','));
  }

  const result =
    process.platform === 'win32'
      ? spawnSync(electronRebuildBin, args, { stdio: 'inherit', shell: true })
      : spawnSync(electronRebuildBin, args, { stdio: 'inherit' });

  if (result.error) {
    console.error('postinstall: failed to run electron-rebuild:', result.error);
  }

  if (result.status === 0) return;
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

const disablePty = process.env.EMDASH_DISABLE_PTY === '1';
const disableNativeDb = process.env.EMDASH_DISABLE_NATIVE_DB === '1';

const nativeModules: string[] = [];
if (!disableNativeDb) nativeModules.push('better-sqlite3');
if (!disablePty) nativeModules.push('node-pty');

if (nativeModules.length === 0) {
  process.exit(0);
}

runElectronRebuild(nativeModules);
