import { existsSync } from 'node:fs';
import path from 'node:path';
import { getWindowsEnvValue } from '@main/utils/windows-env';
import type { PlatformAdapter } from './types';

/**
 * Common Windows install locations for CLI tooling. We deliberately enumerate
 * directories that the typical Windows GUI process inherits *without* a user
 * shell profile: the system PATH alone won't include npm global bin, JetBrains
 * Toolbox scripts, or VS Code's `bin` directory unless the user explicitly
 * picked "Add to PATH" during install.
 *
 * Each entry is expanded against `process.env` (or the env passed in) and only
 * survives in the augmented PATH if the directory actually exists on disk —
 * we'd rather skip a missing dir than leave dead entries cluttering PATH.
 */
const WINDOWS_PATH_TEMPLATES: ReadonlyArray<(env: NodeJS.ProcessEnv) => string | null> = [
  // npm global bin (default for npm < 7 and most install flows)
  (env) => {
    const appData = getWindowsEnvValue(env, 'APPDATA');
    return appData ? path.win32.join(appData, 'npm') : null;
  },
  // pnpm global bin (per-user)
  (env) => {
    const localAppData = getWindowsEnvValue(env, 'LOCALAPPDATA');
    return localAppData ? path.win32.join(localAppData, 'pnpm') : null;
  },
  // Node.js install (LTS / current)
  (env) => {
    const programFiles = getWindowsEnvValue(env, 'ProgramFiles');
    return programFiles ? path.win32.join(programFiles, 'nodejs') : null;
  },
  (env) => {
    const programFilesX86 = getWindowsEnvValue(env, 'ProgramFiles(x86)');
    return programFilesX86 ? path.win32.join(programFilesX86, 'nodejs') : null;
  },
  // VS Code (per-user install — most common)
  (env) => {
    const localAppData = getWindowsEnvValue(env, 'LOCALAPPDATA');
    return localAppData
      ? path.win32.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin')
      : null;
  },
  (env) => {
    const localAppData = getWindowsEnvValue(env, 'LOCALAPPDATA');
    return localAppData
      ? path.win32.join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'bin')
      : null;
  },
  // VS Code (system install)
  (env) => {
    const programFiles = getWindowsEnvValue(env, 'ProgramFiles');
    return programFiles ? path.win32.join(programFiles, 'Microsoft VS Code', 'bin') : null;
  },
  // Cursor (per-user)
  (env) => {
    const localAppData = getWindowsEnvValue(env, 'LOCALAPPDATA');
    return localAppData ? path.win32.join(localAppData, 'Programs', 'cursor', 'bin') : null;
  },
  // JetBrains Toolbox shell scripts
  (env) => {
    const localAppData = getWindowsEnvValue(env, 'LOCALAPPDATA');
    return localAppData ? path.win32.join(localAppData, 'JetBrains', 'Toolbox', 'scripts') : null;
  },
  // Git for Windows (cmd shim used by many tools)
  (env) => {
    const programFiles = getWindowsEnvValue(env, 'ProgramFiles');
    return programFiles ? path.win32.join(programFiles, 'Git', 'cmd') : null;
  },
  // GitHub CLI (system install)
  (env) => {
    const programFiles = getWindowsEnvValue(env, 'ProgramFiles');
    return programFiles ? path.win32.join(programFiles, 'GitHub CLI') : null;
  },
];

function dedupe(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

class WindowsPlatformAdapter implements PlatformAdapter {
  readonly platform: NodeJS.Platform = 'win32';
  readonly isWindows = true;
  readonly hookCommandKind = 'powershell' as const;

  private cachedEntries: readonly string[] | null = null;
  private cachedEnvSeed: string | null = null;

  constructor(
    private readonly fileExists: (p: string) => boolean = existsSync,
    private readonly resolveExecutable: (name: string, env: NodeJS.ProcessEnv) => string | null = (
      _n,
      _e
    ) => null
  ) {}

  augmentedPathEntries(): readonly string[] {
    return this.augmentedPathFor(process.env);
  }

  augmentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const augmented = { ...env };
    const extra = this.augmentedPathFor(env);
    if (extra.length === 0) return augmented;

    const pathKey = Object.keys(augmented).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const existing = (augmented[pathKey] ?? '').split(path.win32.delimiter).filter(Boolean);
    const merged = dedupe([...extra, ...existing]);
    augmented[pathKey] = merged.join(path.win32.delimiter);
    return augmented;
  }

  pathsEqual(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
  }

  basenameAny(p: string): string {
    return path.win32.basename(p.replace(/\//g, '\\'));
  }

  preferredInteractiveShell(env: NodeJS.ProcessEnv): string | null {
    // Prefer PowerShell 7 (`pwsh.exe`) when present — it's the modern default
    // for users who installed it. Fall back to bundled Windows PowerShell, then
    // cmd.exe (handled by the spawn layer).
    const augmentedEnv = this.augmentEnv(env);
    const pwsh = this.resolveExecutable('pwsh.exe', augmentedEnv);
    if (pwsh) return pwsh;
    const winPwsh = this.resolveExecutable('powershell.exe', augmentedEnv);
    if (winPwsh) return winPwsh;
    return null;
  }

  private augmentedPathFor(env: NodeJS.ProcessEnv): readonly string[] {
    const seed = `${getWindowsEnvValue(env, 'APPDATA') ?? ''}|${getWindowsEnvValue(env, 'LOCALAPPDATA') ?? ''}|${getWindowsEnvValue(env, 'ProgramFiles') ?? ''}|${getWindowsEnvValue(env, 'ProgramFiles(x86)') ?? ''}`;
    if (this.cachedEntries && this.cachedEnvSeed === seed) {
      return this.cachedEntries;
    }
    const entries: string[] = [];
    for (const tpl of WINDOWS_PATH_TEMPLATES) {
      const candidate = tpl(env);
      if (candidate && this.fileExists(candidate)) {
        entries.push(candidate);
      }
    }
    this.cachedEntries = dedupe(entries);
    this.cachedEnvSeed = seed;
    return this.cachedEntries;
  }
}

export function createWindowsPlatformAdapter(deps?: {
  fileExists?: (p: string) => boolean;
  resolveExecutable?: (name: string, env: NodeJS.ProcessEnv) => string | null;
}): PlatformAdapter {
  return new WindowsPlatformAdapter(deps?.fileExists, deps?.resolveExecutable);
}
