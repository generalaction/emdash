import { existsSync } from 'node:fs';
import path from 'node:path';
import { getWindowsEnvValue } from '@main/utils/windows-env';
import { createPosixPlatformAdapter } from './posix';
import type { PlatformAdapter } from './types';
import { createWindowsPlatformAdapter } from './windows';

export type { PlatformAdapter } from './types';

function resolveWindowsExecutable(name: string, env: NodeJS.ProcessEnv): string | null {
  const exts = (getWindowsEnvValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`));
  const dirs = (getWindowsEnvValue(env, 'PATH') ?? '').split(path.win32.delimiter).filter(Boolean);
  const hasExt = path.win32.extname(name).length > 0;
  const candidatesPerDir = (dir: string): string[] => {
    if (hasExt) return [path.win32.join(dir, name)];
    return exts.map((ext) => path.win32.join(dir, `${name}${ext}`));
  };
  for (const dir of dirs) {
    for (const candidate of candidatesPerDir(dir)) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function buildPlatform(): PlatformAdapter {
  if (process.platform === 'win32') {
    return createWindowsPlatformAdapter({
      fileExists: existsSync,
      resolveExecutable: resolveWindowsExecutable,
    });
  }
  return createPosixPlatformAdapter(process.platform);
}

/** Singleton platform adapter selected at import time. */
export const platform: PlatformAdapter = buildPlatform();
