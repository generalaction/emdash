import { spawn } from 'node:child_process';
import type { GitRunResult } from './run-git';

export type GitStreamingOptions = {
  cwd: string;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  onProgress?: (progress: { percent?: number; message?: string }) => void;
};

export async function runGitStreaming(
  args: string[],
  options: GitStreamingOptions
): Promise<GitRunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: mergeBatchModeSshCommand(process.env.GIT_SSH_COMMAND),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: GitRunResult) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const onData = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString();
      if (target === 'stdout') stdout += text;
      else stderr += text;
      options.onOutput?.(text);
      const progress = parseGitProgress(text);
      if (progress) options.onProgress?.(progress);
    };

    const onAbort = () => {
      child.kill('SIGTERM');
      finish({
        success: false,
        error: {
          type: 'git-error',
          message: 'Git command was cancelled',
          stdout,
          stderr,
          code: 'cancelled',
        },
      });
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => onData('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => onData('stderr', chunk));
    child.on('error', (error) =>
      finish({
        success: false,
        error: {
          type: 'git-error',
          message: error.message,
          stdout,
          stderr,
        },
      })
    );
    child.on('close', (code) => {
      if (code === 0) {
        finish({ success: true, data: { stdout, stderr } });
        return;
      }
      finish({
        success: false,
        error: {
          type: 'git-error',
          message: stderr.trim() || `Git exited with code ${code ?? 'unknown'}`,
          stdout,
          stderr,
          code: code ?? undefined,
        },
      });
    });
  });
}

export function parseGitProgress(
  chunk: string
): { percent?: number; message?: string } | undefined {
  const line = chunk
    .split(/\r?\n|\r/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) return undefined;

  const match = /^(?<label>[^:]+):\s+(?<percent>\d{1,3})%/.exec(line);
  if (!match?.groups) return { message: line };
  return {
    percent: Math.min(100, Number(match.groups.percent)),
    message: line,
  };
}

function mergeBatchModeSshCommand(existing: string | undefined): string {
  const batchModeArg = '-oBatchMode=yes';
  if (!existing) return `ssh ${batchModeArg}`;
  return existing.includes('BatchMode') ? existing : `${existing} ${batchModeArg}`;
}
