import { createBoundExec, type BoundExec } from '@services/exec/api';

export function createWorkspaceHostGitExec(cwd: string): BoundExec {
  return createBoundExec({
    file: 'git',
    cwd,
    env: {
      ...process.env,
      LC_ALL: 'C',
      LANG: 'C',
      LANGUAGE: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
    },
  });
}
