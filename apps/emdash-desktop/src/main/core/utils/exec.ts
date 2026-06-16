import fs from 'node:fs';

function resolveGitBin(): string {
  const candidates = [
    (process.env.GIT_PATH || '').trim(),
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
