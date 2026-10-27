import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

// Resolve the pnpm that invoked this script. Under pnpm, npm_execpath points
// at pnpm's entry (a JS file or a binary); fall back to `pnpm` on PATH so the
// script also works when run directly.
function getPnpmCommand(extraArgs: string[]): { command: string; args: string[] } {
  const execPath = process.env.npm_execpath;
  if (execPath && /\.[cm]?js$/.test(execPath)) {
    return { command: process.execPath, args: [execPath, ...extraArgs] };
  }
  return { command: execPath || 'pnpm', args: extraArgs };
}

// Install the isolated better-sqlite3 for the system-Node ABI unconditionally.
// tooling/node-deps is anchored as its own pnpm workspace root (own
// pnpm-workspace.yaml + pnpm-lock.yaml); Vitest fixture and migration projects
// alias better-sqlite3 to this copy so the root node_modules/better-sqlite3
// can stay Electron-compiled at all times. The absolute --dir keeps the
// install anchored regardless of cwd.
const sideProjectDir = path.join(appRoot, 'tooling', 'node-deps');
const pnpm = getPnpmCommand(['--dir', sideProjectDir, 'install']);
const toolingInstall = spawnSync(pnpm.command, pnpm.args, {
  stdio: 'inherit',
  cwd: appRoot,
  shell: process.platform === 'win32',
});
if (toolingInstall.error) {
  console.error(
    'postinstall: failed to run pnpm install for tooling/node-deps:',
    toolingInstall.error
  );
  process.exit(1);
}
if (typeof toolingInstall.status === 'number' && toolingInstall.status !== 0) {
  process.exit(toolingInstall.status);
}

// node-pty is used via its bundled N-API prebuild (it is no longer rebuilt for
// Electron — one binary serves both runtimes). Upstream tarballs ship the
// macOS spawn-helper prebuild without the executable bit, which the old
// always-compile path masked; restore it so the prebuild can spawn processes.
if (process.platform === 'darwin') {
  const workspaceRoot = path.resolve(appRoot, '..', '..');
  for (const base of [appRoot, workspaceRoot]) {
    const helper = path.join(
      base,
      'node_modules',
      'node-pty',
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper'
    );
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
    }
  }
}

if (process.env.CI || process.env.EMDASH_SKIP_ELECTRON_REBUILD === '1') {
  process.exit(0);
}

function getElectronRebuildBin() {
  const binName = process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild';

  // With pnpm workspaces + hoisted linker the binary lands in the workspace root
  // node_modules/.bin. Check both the app-local location and the workspace root.
  const workspaceRoot = path.resolve(appRoot, '..', '..');
  for (const base of [appRoot, workspaceRoot]) {
    const candidate = path.join(base, 'node_modules', '.bin', binName);
    if (existsSync(candidate)) return candidate;
  }
  return path.join(appRoot, 'node_modules', '.bin', binName);
}

function runElectronRebuild(onlyModules: string[]) {
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

// Only better-sqlite3 needs an Electron-ABI build (fetched as a prebuild when
// upstream ships one for the current Electron ABI). node-pty is a pure N-API
// addon — its one install-time binary serves both the Node and Electron
// runtimes — so it is never rebuilt here, and EMDASH_DISABLE_PTY needs no
// postinstall handling anymore.
const disableNativeDb = process.env.EMDASH_DISABLE_NATIVE_DB === '1';

if (disableNativeDb) {
  process.exit(0);
}

runElectronRebuild(['better-sqlite3']);
