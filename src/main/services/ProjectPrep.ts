import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

function pickNodeInstallCmd(target: string): string[] {
  // Prefer package manager based on lockfile presence
  if (existsSync(join(target, 'pnpm-lock.yaml'))) {
    return ['pnpm install --frozen-lockfile', 'pnpm install'];
  }
  if (existsSync(join(target, 'yarn.lock'))) {
    // Support modern Yarn (Berry) and classic Yarn
    return ['yarn install --immutable', 'yarn install --frozen-lockfile', 'yarn install'];
  }
  if (existsSync(join(target, 'bun.lockb'))) {
    return ['bun install'];
  }
  if (existsSync(join(target, 'package-lock.json'))) {
    return ['npm ci', 'npm install'];
  }
  return ['npm install'];
}

function runInBackground(cmd: string | string[], cwd: string) {
  const command = Array.isArray(cmd) ? cmd.filter(Boolean).join(' || ') : cmd;
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  // Avoid unhandled errors from bubbling; ignore failures silently
  child.on('error', () => {});
  child.unref?.();
}

/**
 * Best-effort dependency prep for common project types.
 * Non-blocking; spawns installs in background if needed.
 */
export async function ensureProjectPrepared(targetPath: string) {
  try {
    // Node projects: if package.json exists and node_modules missing, install deps
    const isNode = existsSync(join(targetPath, 'package.json'));
    const hasNodeModules = existsSync(join(targetPath, 'node_modules'));
    if (isNode && !hasNodeModules) {
      const cmds = pickNodeInstallCmd(targetPath);
      runInBackground(cmds, targetPath);
    }

    // Optional: we could add Python prep here later if desired
  } catch {
    // ignore
  }
}
