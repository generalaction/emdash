import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitPlatform } from '../../../shared/git/platform';
import type { CommandExecutor } from './types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const GIT = 'git';

function cliName(platform: GitPlatform): string {
  return platform === 'gitlab' ? 'glab' : 'gh';
}

export function createLocalExecutor(cwd: string, platform: GitPlatform): CommandExecutor {
  const cli = cliName(platform);

  return {
    cwd,

    async exec(cmd) {
      const { stdout, stderr } = await execAsync(cmd, { cwd });
      return { stdout: stdout || '', stderr: stderr || '' };
    },

    async execGit(args) {
      const { stdout, stderr } = await execFileAsync(GIT, args.split(/\s+/), { cwd });
      return { stdout: stdout || '', stderr: stderr || '' };
    },

    async execPlatformCli(args) {
      try {
        const { stdout, stderr } = await execAsync(`${cli} ${args}`, { cwd });
        return { exitCode: 0, stdout: stdout || '', stderr: stderr || '' };
      } catch (err: any) {
        return {
          exitCode: typeof err?.code === 'number' ? err.code : 1,
          stdout: err?.stdout || '',
          stderr: err?.stderr || '',
        };
      }
    },
  };
}

export interface RemoteGitServiceLike {
  execGh(
    connId: string,
    path: string,
    args: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  execGlab(
    connId: string,
    path: string,
    args: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  execGit(
    connId: string,
    path: string,
    args: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export function createRemoteExecutor(
  connectionId: string,
  taskPath: string,
  platform: GitPlatform,
  remote: RemoteGitServiceLike
): CommandExecutor {
  const execCli =
    platform === 'gitlab'
      ? (args: string) => remote.execGlab(connectionId, taskPath, args)
      : (args: string) => remote.execGh(connectionId, taskPath, args);

  return {
    cwd: taskPath,

    async exec(cmd) {
      const result = await remote.execGit(connectionId, taskPath, cmd);
      if (result.exitCode !== 0) {
        const err = new Error(result.stderr || 'Remote exec failed') as any;
        err.stdout = result.stdout;
        err.stderr = result.stderr;
        throw err;
      }
      return { stdout: result.stdout || '', stderr: result.stderr || '' };
    },

    async execGit(args) {
      const result = await remote.execGit(connectionId, taskPath, args);
      if (result.exitCode !== 0) {
        const err = new Error(result.stderr || 'Remote git failed') as any;
        err.stdout = result.stdout;
        err.stderr = result.stderr;
        throw err;
      }
      return { stdout: result.stdout || '', stderr: result.stderr || '' };
    },

    async execPlatformCli(args) {
      return execCli(args);
    },
  };
}
