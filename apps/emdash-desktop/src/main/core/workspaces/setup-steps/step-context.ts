import type { CheckoutSelector, RepositorySelector } from '@emdash/core/git';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FilesClientScope } from '@main/core/files/runtime-process/client';
import type { GitRuntimeClient } from '@main/core/git/runtime-process/host';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type { WorktreeService } from '@main/core/projects/worktrees/worktree-service';

/**
 * Context passed to every workspace setup step executor.
 * Mirrors the dependencies available inside WorktreeService, making
 * step handlers self-contained and easy to unit-test.
 */
export type StepContext = {
  /** Execution context for non-domain setup commands. */
  ctx: IExecutionContext;
  /** Absolute path to the project repository root. */
  repoPath: string;
  /** Absolute path to the worktree pool directory where worktrees are created. */
  worktreePoolPath: string;
  /** Project-root Files runtime capability. */
  files: FilesClientScope;
  /** Git runtime client and the selectors bound to this project. */
  git: GitRuntimeClient;
  repository: RepositorySelector;
  checkout: CheckoutSelector;
  /** Project settings provider (used by copy-preserved-files). */
  projectSettings: ProjectSettingsProvider;
  /** Worktree service that owns checkout validation, stale cleanup, and checkout creation. */
  worktreeService: Pick<
    WorktreeService,
    'findBranchAnywhere' | 'removeWorktree' | 'serveBranchWorktree'
  >;
  /**
   * Resolved worktree path from a preceding `add-worktree` step.
   * Populated by the executor after a successful add-worktree step so that
   * subsequent steps (e.g. copy-preserved-files) can reference it.
   */
  resolvedWorktreePath?: string;
};
