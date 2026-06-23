import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';

const MAX_OUTPUT_CHARS = 4000;

export type WorktreeLifecycleCommandKind = 'create' | 'teardown';

export type WorktreeLifecycleCommandVariables = {
  branchName: string;
  targetDir: string;
  worktreePath: string;
  projectId: string;
  taskId: string;
  workspaceId: string;
  projectPath: string;
  sourceBranch?: string;
};

export type RunWorktreeLifecycleCommandArgs = {
  kind: WorktreeLifecycleCommandKind;
  command: string;
  variables: WorktreeLifecycleCommandVariables;
  ctx: IExecutionContext;
};

export class WorktreeLifecycleCommandError extends Error {
  readonly kind: WorktreeLifecycleCommandKind;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    kind: WorktreeLifecycleCommandKind,
    message: string,
    output: { stdout?: string; stderr?: string } = {}
  ) {
    super(message);
    this.name = 'WorktreeLifecycleCommandError';
    this.kind = kind;
    this.stdout = truncateOutput(output.stdout ?? '');
    this.stderr = truncateOutput(output.stderr ?? '');
  }
}

export function buildWorktreeLifecycleEnvironment(
  variables: WorktreeLifecycleCommandVariables
): Record<string, string> {
  return {
    EMDASH_BRANCH_NAME: variables.branchName,
    EMDASH_TARGET_DIR: variables.targetDir,
    EMDASH_WORKTREE_PATH: variables.worktreePath,
    EMDASH_PROJECT_ID: variables.projectId,
    EMDASH_TASK_ID: variables.taskId,
    EMDASH_WORKSPACE_ID: variables.workspaceId,
    EMDASH_PROJECT_PATH: variables.projectPath,
    EMDASH_SOURCE_BRANCH: variables.sourceBranch ?? '',
  };
}

export function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]`;
}

export function buildShellCommandWithEnvironment(
  command: string,
  variables: WorktreeLifecycleCommandVariables
): string {
  const environment = buildWorktreeLifecycleEnvironment(variables);
  const assignments = Object.entries(environment)
    .map(([key, value]) => `${key}=${quoteShellArg(value)}`)
    .join('; ');
  const exports = Object.keys(environment).join(' ');
  return `${assignments}; export ${exports}; ${command}`;
}

export async function runWorktreeLifecycleCommand({
  kind,
  command,
  variables,
  ctx,
}: RunWorktreeLifecycleCommandArgs): Promise<void> {
  const shellCommand = buildShellCommandWithEnvironment(command, variables);
  try {
    await ctx.exec('/bin/sh', ['-c', shellCommand], { maxBuffer: MAX_OUTPUT_CHARS * 4 });
  } catch (error) {
    const output =
      error && typeof error === 'object'
        ? {
            stdout: 'stdout' in error ? String(error.stdout) : '',
            stderr: 'stderr' in error ? String(error.stderr) : '',
          }
        : {};
    const stderr = output.stderr?.trim();
    const message = stderr
      ? `Custom worktree ${kind} command failed: ${truncateOutput(stderr)}`
      : `Custom worktree ${kind} command failed: ${error instanceof Error ? error.message : String(error)}`;
    log.warn('Custom worktree lifecycle command failed', {
      kind,
      stdout: output.stdout ? truncateOutput(output.stdout) : undefined,
      stderr: output.stderr ? truncateOutput(output.stderr) : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new WorktreeLifecycleCommandError(kind, message, output);
  }
}
