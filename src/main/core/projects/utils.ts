import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ExecFn } from './worktrees/worktree-service';

const execAsync = promisify(exec);

export function parseGitHubRepo(remoteUrl: string): { host: string; nameWithOwner: string } | null {
  // https://github.mycompany.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/https?:\/\/(github\.[^/]+)\/([^/]+\/[^/.]+)(?:\.git)?$/);
  if (httpsMatch) {
    return { host: httpsMatch[1], nameWithOwner: httpsMatch[2] };
  }
  // git@github.mycompany.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@(github\.[^:]+):([^/]+\/[^/.]+)(?:\.git)?$/);
  if (sshMatch) {
    return { host: sshMatch[1], nameWithOwner: sshMatch[2] };
  }
  return null;
}

export function getLocalExec(): ExecFn {
  return (
    command: string,
    args: string[] = [],
    options: { cwd?: string; timeout?: number } = {}
  ) => {
    return execAsync(`command ${command} ${args.join(' ')}`, options);
  };
}
