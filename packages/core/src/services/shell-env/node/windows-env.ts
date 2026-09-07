import path from 'node:path';
import { getWindowsEnvKey, getWindowsEnvValue } from '#primitives/agent-env/api';

export { getWindowsEnvKey, getWindowsEnvValue } from '#primitives/agent-env/api';

export function getWindowsPathEnvKey(env: NodeJS.ProcessEnv): string {
  return getWindowsEnvKey(env, 'PATH') ?? 'PATH';
}

export function prependWindowsPathEntry(env: NodeJS.ProcessEnv, entry: string): boolean {
  const pathKey = getWindowsPathEnvKey(env);
  const entries = (env[pathKey] ?? '').split(path.win32.delimiter).filter(Boolean);
  const existing = new Set(entries.map((item) => item.toLowerCase()));

  if (existing.has(entry.toLowerCase())) {
    return false;
  }

  env[pathKey] = [entry, ...entries].join(path.win32.delimiter);
  return true;
}

export function windowsNpmGlobalBin(env: NodeJS.ProcessEnv): string | null {
  const appData = getWindowsEnvValue(env, 'APPDATA');
  return appData ? path.win32.join(appData, 'npm') : null;
}

export function ensureWindowsNpmGlobalBinInPath(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const npmPath = windowsNpmGlobalBin(env);
  if (!npmPath) return null;
  return prependWindowsPathEntry(env, npmPath) ? npmPath : null;
}
