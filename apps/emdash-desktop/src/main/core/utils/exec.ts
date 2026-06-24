import fs from 'node:fs';
import path from 'node:path';

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const pathExt = env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return pathExt
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
    .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`));
}

function findExecutableOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const pathValue = env.PATH;
  if (!pathValue) return null;

  const extensions =
    process.platform === 'win32' && !path.extname(name)
      ? ['', ...windowsExecutableExtensions(env)]
      : [''];

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;

    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }

  return null;
}

export function resolveGitBin(env: NodeJS.ProcessEnv = process.env): string {
  const pathGit = findExecutableOnPath('git', env);
  const candidates = [
    (env.GIT_PATH || '').trim(),
    pathGit,
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
    '/usr/bin/git',
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return 'git';
}

/** Resolved path to the `git` binary — use for all git exec calls. */
export const GIT_EXECUTABLE = resolveGitBin();

export function isMissingGitExecutableError(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException | undefined;
  return err?.code === 'ENOENT' && (err.path === 'git' || err.path === GIT_EXECUTABLE);
}

export function missingGitExecutableError(): Error {
  return new Error(
    'Git is not installed or Emdash cannot find it. Install Git, then restart Emdash.'
  );
}
