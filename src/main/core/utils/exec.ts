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

function shouldUseHttpRemote(args: string[]): boolean {
  const subcommand = args[0];
  if (!subcommand) return false;
  if (['clone', 'fetch', 'pull', 'push', 'ls-remote'].includes(subcommand)) return true;
  return subcommand === 'remote' && args[1] === 'show';
}

export async function addGitHubAuthConfig(
  args: string[],
  getToken: () => Promise<string | null>
): Promise<string[]> {
  const rawToken = await getToken();
  if (!rawToken) return args;

  const token = Buffer.from(`x-access-token:${rawToken}`).toString('base64');
  if (!token) return args;

  const withAuth = ['-c', `http.https://github.com/.extraHeader=Authorization: Basic ${token}`];

  if (shouldUseHttpRemote(args)) {
    withAuth.push(
      '-c',
      'url.https://github.com/.insteadOf=git@github.com:',
      '-c',
      'url.https://github.com/.insteadOf=ssh://git@github.com:',
      '-c',
      'url.https://github.com/.insteadOf=ssh://git@github.com/'
    );
  }

  return [...withAuth, ...args];
}
