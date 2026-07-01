import { describe, expect, it } from 'vitest';
import {
  buildShellCommandWithEnvironment,
  buildWorktreeLifecycleEnvironment,
  truncateOutput,
  type WorktreeLifecycleCommandVariables,
} from './custom-worktree-command';

const variables: WorktreeLifecycleCommandVariables = {
  branchName: "feature/paul's-test",
  targetDir: "/tmp/worktrees/paul's repo",
  worktreePath: "/tmp/worktrees/paul's repo",
  projectId: 'project-1',
  taskId: 'task-1',
  workspaceId: 'workspace-1',
  projectPath: '/repo/main',
  sourceBranch: 'main',
};

describe('custom worktree command helpers', () => {
  it('builds the documented environment variables', () => {
    expect(buildWorktreeLifecycleEnvironment(variables)).toEqual({
      EMDASH_BRANCH_NAME: "feature/paul's-test",
      EMDASH_TARGET_DIR: "/tmp/worktrees/paul's repo",
      EMDASH_WORKTREE_PATH: "/tmp/worktrees/paul's repo",
      EMDASH_PROJECT_ID: 'project-1',
      EMDASH_TASK_ID: 'task-1',
      EMDASH_WORKSPACE_ID: 'workspace-1',
      EMDASH_PROJECT_PATH: '/repo/main',
      EMDASH_SOURCE_BRANCH: 'main',
    });
  });

  it('shell-quotes environment variable values', () => {
    const command = buildShellCommandWithEnvironment(
      'graft create "$EMDASH_BRANCH_NAME" "$EMDASH_TARGET_DIR"',
      variables
    );

    expect(command).toContain("EMDASH_BRANCH_NAME='feature/paul'\\''s-test'");
    expect(command).toContain("EMDASH_TARGET_DIR='/tmp/worktrees/paul'\\''s repo'");
    expect(command).toContain('export EMDASH_BRANCH_NAME');
    expect(command).toContain('graft create "$EMDASH_BRANCH_NAME" "$EMDASH_TARGET_DIR"');
  });

  it('truncates long command output deterministically', () => {
    expect(truncateOutput('a'.repeat(4010))).toBe(`${'a'.repeat(4000)}\n[truncated]`);
  });
});
