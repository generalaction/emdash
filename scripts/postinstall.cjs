const { spawnSync } = require('node:child_process');
const path = require('node:path');

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
    // eslint-disable-next-line no-console
    console.error('postinstall: failed to run electron-rebuild:', result.error);
  }

  if (result.status === 0) return;
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

const disablePty = process.env.EMDASH_DISABLE_PTY === '1';
const disableNativeDb = process.env.EMDASH_DISABLE_NATIVE_DB === '1';

const nativeModules = [];
if (!disableNativeDb) nativeModules.push('sqlite3');
if (!disablePty) nativeModules.push('node-pty');
nativeModules.push('keytar');

if (nativeModules.length === 0) {
  process.exit(0);
}

runElectronRebuild(nativeModules);

