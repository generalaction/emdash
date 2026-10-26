import { createBoundExec, type BoundExec } from '#services/exec/api';
import { BATCH_SSH_COMMAND, batchSshProgram } from './git-ssh';

export type GitExecFactory = (cwd: string) => BoundExec;

/**
 * Full child environment for app-managed git. Git needs the process env (PATH, HOME,
 * SSH_AUTH_SOCK, credential helpers), so it is composed in deliberately — exec itself never
 * merges `process.env`. Every prompt channel is disabled so background git work fails fast
 * instead of blocking on credential or host-key input, and the C locale keeps parsed output
 * and error classification stable.
 *
 * Git takes its SSH program from GIT_SSH_COMMAND, then core.sshCommand, then GIT_SSH. The
 * batch-mode default fills only the GIT_SSH slot, so an SSH command the user configured in
 * any of them, including repository and conditional config, still wins.
 */
export function nonInteractiveGitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    LC_ALL: 'C',
    LANG: 'C',
    LANGUAGE: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  };
  // Git would try to run an empty value as the SSH program, so treat it as unset.
  if (!env.GIT_SSH_COMMAND) delete env.GIT_SSH_COMMAND;
  if (!env.GIT_SSH) delete env.GIT_SSH;
  if (env.GIT_SSH_COMMAND || env.GIT_SSH) return env;

  const program = batchSshProgram();
  if (program) env.GIT_SSH = program;
  // Without the wrapper, stay non-interactive even though this overrides core.sshCommand.
  else env.GIT_SSH_COMMAND = BATCH_SSH_COMMAND;
  return env;
}

/** Non-interactive git exec bound to `cwd`, over the current process environment. */
export function createNonInteractiveGitExec(cwd: string): BoundExec {
  return createBoundExec({ file: 'git', cwd, env: nonInteractiveGitEnv(process.env) });
}

export const defaultGitExecFactory: GitExecFactory = (cwd) => createNonInteractiveGitExec(cwd);
