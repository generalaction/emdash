import { normalizeRepositoryHost } from '@shared/repository-ref';

/**
 * git subcommands that contact a remote and therefore need credentials.
 * Local-only subcommands (worktree, branch, config, status, ...) are excluded
 * so we never attach a token to a process that has no reason to see it.
 */
const NETWORK_GIT_SUBCOMMANDS = new Set(['fetch', 'push', 'clone', 'ls-remote']);

/**
 * Global git options (before the subcommand) that consume a *separate* value,
 * e.g. `git -C <path> fetch` or `git -c key=val push`. Their values must be
 * skipped so they are not mistaken for the subcommand. The `--opt=value` forms
 * are handled generically by the leading-dash check below.
 */
const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--super-prefix',
  '--config-env',
]);

/** True when `command`/`args` is a git invocation whose subcommand hits the network. */
export function isNetworkGitCommand(command: string, args: readonly string[]): boolean {
  if (command !== 'git') return false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (GLOBAL_OPTIONS_WITH_VALUE.has(arg)) {
      index += 1; // skip this option's separate value
      continue;
    }
    if (arg.startsWith('-')) continue; // flag, or `--opt=value` form
    // First bare token is the subcommand.
    return NETWORK_GIT_SUBCOMMANDS.has(arg);
  }
  return false;
}

/** Parse a valid, positive GIT_CONFIG_COUNT from an env, or 0 when absent/invalid. */
function existingGitConfigCount(env: NodeJS.ProcessEnv): number {
  const raw = env.GIT_CONFIG_COUNT;
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Build environment variables that make a single git invocation send a GitHub
 * token as an Authorization header, scoped to `host`.
 *
 * Uses GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n (git >= 2.31) to
 * set `http.https://<host>/.extraheader`, so the token:
 *   - never appears in argv (unlike `-c http.extraheader=...`),
 *   - never touches disk (unlike a credential-helper script),
 *   - applies only to requests to `host` (unlike an unscoped extraheader).
 *
 * This mirrors the mechanism used by actions/checkout. GitHub accepts the token
 * as the Basic-auth password with the `x-access-token` username.
 *
 * The extraheader is *appended* after any GIT_CONFIG_* entries already present
 * in `baseEnv` (proxy, safe.directory, protocol config, ...) rather than
 * overwriting index 0, so pre-existing git config from the environment survives.
 */
export function buildGitHubAuthEnv(
  host: string,
  token: string,
  baseEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const normalizedHost = normalizeRepositoryHost(host) || 'github.com';
  const basicAuth = Buffer.from(`x-access-token:${token}`).toString('base64');
  const index = existingGitConfigCount(baseEnv);
  return {
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: `http.https://${normalizedHost}/.extraheader`,
    [`GIT_CONFIG_VALUE_${index}`]: `Authorization: Basic ${basicAuth}`,
  };
}
