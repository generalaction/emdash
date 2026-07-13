import { normalizeRepositoryHost } from '@shared/repository-ref';

/**
 * git subcommands that contact a remote and therefore need credentials.
 * Local-only subcommands (worktree, branch, config, status, ...) are excluded
 * so we never attach a token to a process that has no reason to see it.
 */
const NETWORK_GIT_SUBCOMMANDS = new Set(['fetch', 'push', 'clone', 'ls-remote']);

/** True when `command`/`args` is a git invocation whose subcommand hits the network. */
export function isNetworkGitCommand(command: string, args: readonly string[]): boolean {
  if (command !== 'git') return false;
  // The subcommand is the first non-flag token (e.g. `-c foo=bar fetch` -> `fetch`).
  const subcommand = args.find((arg) => !arg.startsWith('-'));
  return subcommand !== undefined && NETWORK_GIT_SUBCOMMANDS.has(subcommand);
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
 * NOTE: emdash does not otherwise set GIT_CONFIG_* env vars, so overwriting
 * index 0 here is safe. If that ever changes, this must merge with the existing
 * count rather than assume a single entry.
 */
export function buildGitHubAuthEnv(host: string, token: string): Record<string, string> {
  const normalizedHost = normalizeRepositoryHost(host) || 'github.com';
  const basicAuth = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.https://${normalizedHost}/.extraheader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicAuth}`,
  };
}
