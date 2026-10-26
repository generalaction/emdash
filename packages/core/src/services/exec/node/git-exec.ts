import { createBoundExec, type BoundExec } from '#services/exec/api';

export type GitExecFactory = (cwd: string) => BoundExec;

/**
 * Full child environment for app-managed git. Git needs the process env (PATH, HOME,
 * SSH_AUTH_SOCK, credential helpers), so it is composed in deliberately — exec itself never
 * merges `process.env`. Every prompt channel is disabled so background git work fails fast
 * instead of blocking on credential or host-key input, and the C locale keeps parsed output
 * and error classification stable.
 */
export function nonInteractiveGitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    LC_ALL: 'C',
    LANG: 'C',
    LANGUAGE: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    ...(base.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
  };
}

/** Non-interactive git exec bound to `cwd`, over the current process environment. */
export function createNonInteractiveGitExec(cwd: string): BoundExec {
  return createBoundExec({ file: 'git', cwd, env: nonInteractiveGitEnv(process.env) });
}

export const defaultGitExecFactory: GitExecFactory = (cwd) => createNonInteractiveGitExec(cwd);
