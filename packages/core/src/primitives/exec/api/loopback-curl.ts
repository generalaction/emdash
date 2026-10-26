/**
 * A POSIX shell command that runs `curl <args>` against an Emdash loopback endpoint,
 * such as the Git credential helper's or the agent hooks', authenticated by the nonce in
 * the environment variable `nonceVar`.
 *
 * - The `X-Emdash-Token` header never enters a process's argv, which other local users
 *   can read (`/proc/<pid>/cmdline`): the `printf` builtin writes it into curl's config
 *   on fd 3, and curl's stdin stays the caller's, e.g. the request body for `@-`. The
 *   inner group keeps curl's stdin redirected once; zsh would otherwise merge the pipe
 *   into it (MULTIOS).
 * - The command contains no single quotes, so it survives as one GIT_CONFIG_PARAMETERS
 *   value without escaping.
 * - `-q`, which only works as curl's first argument, skips the user's curlrc, and
 *   `--noproxy "*"` ignores proxy variables, so neither can send the request and its
 *   nonce elsewhere or reshape the response.
 *
 * `args` must not use fds 3 or 4.
 */
export function loopbackCurlCommand(nonceVar: string, args: string): string {
  return (
    `{ printf "header = \\"X-Emdash-Token: %s\\"\\n" "$${nonceVar}" | ` +
    `{ curl -q --noproxy "*" -K /dev/fd/3 ${args} 3<&0 0<&4 4<&-; }; } 4<&0`
  );
}
