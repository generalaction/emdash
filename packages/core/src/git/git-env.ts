import { createBoundExec, type BoundExec } from '../exec';

export type CreateGitExecOptions = {
  cwd: string;
  executable?: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * Full child environment for git invocations. Git needs the process env (PATH, HOME,
 * SSH_AUTH_SOCK, credential helpers), so it is composed in deliberately — exec itself
 * never merges `process.env`.
 */
export function gitEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra,
    LC_ALL: 'C',
    LANG: 'C',
    LANGUAGE: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
}

export function createGitExec(options: CreateGitExecOptions): BoundExec {
  return createBoundExec({
    file: options.executable ?? 'git',
    cwd: options.cwd,
    env: gitEnv(options.env),
  });
}
