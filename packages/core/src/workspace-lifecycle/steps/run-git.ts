import { execFile } from 'node:child_process';

export type GitRunOptions = {
  cwd: string;
  signal?: AbortSignal;
};

export type GitRunResult =
  | { success: true; data: { stdout: string; stderr: string } }
  | { success: false; error: GitRunError };

export type GitRunError = {
  type: 'git-error';
  message: string;
  stdout: string;
  stderr: string;
  code?: number | string;
};

export async function runGit(args: string[], options: GitRunOptions): Promise<GitRunResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd: options.cwd,
        signal: options.signal,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: mergeBatchModeSshCommand(process.env.GIT_SSH_COMMAND),
        },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ success: true, data: { stdout, stderr } });
          return;
        }

        const rawCode = typeof error === 'object' && error !== null ? error.code : undefined;
        const code = rawCode ?? undefined;
        resolve({
          success: false,
          error: {
            type: 'git-error',
            message: stderr.trim() || error.message || String(error),
            stdout,
            stderr,
            code,
          },
        });
      }
    );
  });
}

export function gitErrorMessage(error: GitRunError): string {
  return error.stderr.trim() || error.stdout.trim() || error.message;
}

function mergeBatchModeSshCommand(existing: string | undefined): string {
  const batchModeArg = '-oBatchMode=yes';
  if (!existing) return `ssh ${batchModeArg}`;
  return existing.includes('BatchMode') ? existing : `${existing} ${batchModeArg}`;
}
