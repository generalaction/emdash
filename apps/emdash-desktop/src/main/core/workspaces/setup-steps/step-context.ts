import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type { WorktreeHost } from '@main/core/projects/worktrees/hosts/worktree-host';

/**
 * Context passed to every workspace setup step executor.
 * Mirrors the dependencies available inside WorktreeService, making
 * step handlers self-contained and easy to unit-test.
 */
export type StepContext = {
  /** Execution context for running git commands (local or SSH). */
  ctx: IExecutionContext;
  /** Absolute path to the project repository root. */
  repoPath: string;
  /** Absolute path to the worktree pool directory where worktrees are created. */
  worktreePoolPath: string;
  /** Filesystem host (local or SSH). */
  host: WorktreeHost;
  /** Project settings provider (used by copy-preserved-files). */
  projectSettings: ProjectSettingsProvider;
  /**
   * Resolved worktree path from a preceding `add-worktree` step.
   * Populated by the executor after a successful add-worktree step so that
   * subsequent steps (e.g. copy-preserved-files) can reference it.
   */
  resolvedWorktreePath?: string;
};
