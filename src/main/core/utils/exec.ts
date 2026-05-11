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

/**
 * Builds GitHub auth as a git-config-via-env payload + the args that need
 * to be merged into the command. The token is passed via `GIT_CONFIG_*`
 * environment variables instead of `-c` argv entries so it does not appear
 * in `ps`/process listings on either the local or remote host.
 *
 * See `git-config[1]`'s "GIT_CONFIG_COUNT" docs (git ≥ 2.31).
 */
export async function buildGitHubAuthEnv(
  args: string[],
  getToken: () => Promise<string | null>
): Promise<{ args: string[]; env: Record<string, string> }> {
  const rawToken = await getToken();
  if (!rawToken) return { args, env: {} };

  const token = Buffer.from(`x-access-token:${rawToken}`).toString('base64');

  const pairs: Array<[string, string]> = [
    ['http.https://github.com/.extraHeader', `Authorization: Basic ${token}`],
  ];

  if (shouldUseHttpRemote(args)) {
    pairs.push(
      ['url.https://github.com/.insteadOf', 'git@github.com:'],
      ['url.https://github.com/.insteadOf', 'ssh://git@github.com:'],
      ['url.https://github.com/.insteadOf', 'ssh://git@github.com/']
    );
  }

  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });

  return { args, env };
}
