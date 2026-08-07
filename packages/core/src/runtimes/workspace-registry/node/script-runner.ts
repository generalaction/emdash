import { createBoundExec, ExecError, type BoundExec } from '#services/exec/api';

export const DEFAULT_WORKSPACE_SCRIPT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_OUTPUT_TAIL_LENGTH = 8_000;

export type WorkspaceScriptRunInput = {
  id: string;
  command: string;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type WorkspaceScriptRunOutcome =
  | { status: 'succeeded'; outputTail: string }
  | {
      status: 'failed' | 'timed-out' | 'cancelled';
      message: string;
      exitCode?: number;
      outputTail: string;
    };

export type WorkspaceScriptRunner = {
  run(input: WorkspaceScriptRunInput): Promise<WorkspaceScriptRunOutcome>;
};

export type CreateWorkspaceScriptRunnerOptions = {
  shell?: string;
  outputTailLength?: number;
  createExec?: (shell: string, cwd: string) => BoundExec;
};

export function createWorkspaceScriptRunner(
  options: CreateWorkspaceScriptRunnerOptions = {}
): WorkspaceScriptRunner {
  const shell = options.shell ?? process.env.SHELL ?? '/bin/sh';
  const outputTailLength = options.outputTailLength ?? DEFAULT_OUTPUT_TAIL_LENGTH;
  const createExec =
    options.createExec ??
    ((file: string, cwd: string) =>
      createBoundExec({
        file,
        cwd,
        env: { ...process.env, CI: process.env.CI ?? '1' },
      }));

  return {
    async run(input) {
      const exec = createExec(shell, input.cwd);
      let stderr = '';
      try {
        const result = await exec.exec(['-lc', input.command], {
          signal: input.signal,
          timeoutMs: input.timeoutMs ?? DEFAULT_WORKSPACE_SCRIPT_TIMEOUT_MS,
          onStderr: (chunk) => {
            stderr += chunk;
          },
        });
        return {
          status: 'succeeded',
          outputTail: tail(`${result.stdout}${result.stderr}`, outputTailLength),
        };
      } catch (error) {
        if (isAbortError(error) || input.signal?.aborted) {
          return {
            status: 'cancelled',
            message: `Script "${input.id}" was cancelled`,
            outputTail: tail(outputFrom(error, stderr), outputTailLength),
          };
        }
        if (isTimeoutError(error)) {
          return {
            status: 'timed-out',
            message: `Script "${input.id}" timed out after ${
              input.timeoutMs ?? DEFAULT_WORKSPACE_SCRIPT_TIMEOUT_MS
            }ms`,
            outputTail: tail(outputFrom(error, stderr), outputTailLength),
          };
        }
        return {
          status: 'failed',
          message:
            error instanceof Error
              ? error.message
              : `Script "${input.id}" failed: ${String(error)}`,
          ...(error instanceof ExecError && error.exitCode !== null
            ? { exitCode: error.exitCode }
            : {}),
          outputTail: tail(outputFrom(error, stderr), outputTailLength),
        };
      }
    },
  };
}

function outputFrom(error: unknown, stderr: string): string {
  if (error instanceof ExecError) return `${error.stdout}${error.stderr}`;
  return stderr;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof ExecError &&
    error.exitCode === null &&
    error.stderr.startsWith('Timed out after ')
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function tail(output: string, maxLength: number): string {
  return output.length > maxLength ? output.slice(-maxLength) : output;
}
