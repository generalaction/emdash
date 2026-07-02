import { gitErrorMessage, type DiffTarget, type GitObjectRef } from '@emdash/core/git';
import { err, ok } from '@emdash/shared';
import { lastTurnBaselineService } from '@main/core/git/last-turn-baseline-service';
import { resolveWorkspace } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type {
  GitWorktreeCommitResult,
  GitWorktreeMutationResult,
  GitWorktreeSnapshotResult,
} from '@shared/core/git/rpc';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { revertWorktreeFiles, stageWorktreeFiles, unstageWorktreeFiles } from './mutations';

export const gitWorktreeController = createRPCController({
  getWorktreeSnapshot: async (
    projectId: string,
    workspaceId: string
  ): Promise<GitWorktreeSnapshotResult> => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' });
      return ok(await workspace.gitWorktree.getSnapshot());
    } catch (error) {
      log.error('gitCtrl.getWorktreeSnapshot failed', { projectId, workspaceId, error });
      return err({ type: 'git_error', message: gitErrorMessage(error) });
    }
  },

  getChangedFiles: async (projectId: string, workspaceId: string, base: DiffTarget) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ changes: await workspace.gitWorktree.getChangedFiles(base) });
    } catch (error) {
      log.error('gitCtrl.getChangedFiles failed', { projectId, workspaceId, base, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  /**
   * Files changed during the most recent agent turn: the diff between the worktree snapshot
   * captured at the start of that turn and the current worktree (#1635). Returns
   * `{ baseline: null }` when no turn has been captured yet (e.g. before the first prompt or
   * after a restart), so the renderer can fall back to the session diff.
   */
  getLastTurnChanges: async (projectId: string, workspaceId: string) => {
    try {
      const baseTree = lastTurnBaselineService.getBaseline(workspaceId);
      if (!baseTree) return ok({ baseline: null });
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      const headTree = await workspace.gitWorktree.snapshotWorktreeTree();
      const changes = await workspace.gitWorktree.getChangedFilesBetweenTrees(baseTree, headTree);
      // headTree lets the renderer diff baseTree -> headTree via the existing 'git' diff group
      // (both immutable snapshots), so no live working-tree diff mode is needed.
      return ok({ baseline: { baseTree, headTree, changes } });
    } catch (error) {
      log.error('gitCtrl.getLastTurnChanges failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  getFileAtRef: async (projectId: string, workspaceId: string, filePath: string, ref: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ content: await workspace.gitWorktree.getFileAtRef(filePath, ref) });
    } catch (error) {
      log.error('gitCtrl.getFileAtRef failed', { projectId, workspaceId, filePath, ref, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  getFileAtIndex: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ content: await workspace.gitWorktree.getFileAtIndex(filePath) });
    } catch (error) {
      log.error('gitCtrl.getFileAtIndex failed', { projectId, workspaceId, filePath, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  getImageAtRef: async (projectId: string, workspaceId: string, filePath: string, ref: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ result: await workspace.gitWorktree.getImageAtRef(filePath, ref) });
    } catch (error) {
      log.error('gitCtrl.getImageAtRef failed', { projectId, workspaceId, filePath, ref, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  getImageAtIndex: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ result: await workspace.gitWorktree.getImageAtIndex(filePath) });
    } catch (error) {
      log.error('gitCtrl.getImageAtIndex failed', { projectId, workspaceId, filePath, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  stageFiles: (
    projectId: string,
    workspaceId: string,
    filePaths: string[]
  ): Promise<GitWorktreeMutationResult> => {
    return stageWorktreeFiles(
      projectId,
      workspaceId,
      filePaths,
      filePaths.length === 1 ? 'single' : 'multiple'
    );
  },

  stageAllFiles: async (
    projectId: string,
    workspaceId: string
  ): Promise<GitWorktreeMutationResult> => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      const status = await workspace.gitWorktree.getStatus();
      const count = status.kind === 'ok' ? status.unstaged.length : 0;
      const result = await workspace.gitWorktree.stageAll();
      if (!result.success) return err(result.error);
      telemetryService.capture('vcs_files_staged', {
        count,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok({ sequences: result.data });
    } catch (error) {
      log.error('gitCtrl.stageAllFiles failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  unstageFiles: (
    projectId: string,
    workspaceId: string,
    filePaths: string[]
  ): Promise<GitWorktreeMutationResult> => {
    return unstageWorktreeFiles(
      projectId,
      workspaceId,
      filePaths,
      filePaths.length === 1 ? 'single' : 'multiple'
    );
  },

  unstageAllFiles: async (
    projectId: string,
    workspaceId: string
  ): Promise<GitWorktreeMutationResult> => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      const status = await workspace.gitWorktree.getStatus();
      const count = status.kind === 'ok' ? status.staged.length : 0;
      const result = await workspace.gitWorktree.unstageAll();
      if (!result.success) return err(result.error);
      telemetryService.capture('vcs_files_unstaged', {
        count,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok({ sequences: result.data });
    } catch (error) {
      log.error('gitCtrl.unstageAllFiles failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  revertFiles: (
    projectId: string,
    workspaceId: string,
    filePaths: string[]
  ): Promise<GitWorktreeMutationResult> => {
    return revertWorktreeFiles(
      projectId,
      workspaceId,
      filePaths,
      filePaths.length === 1 ? 'single' : 'multiple'
    );
  },

  revertAllFiles: async (
    projectId: string,
    workspaceId: string
  ): Promise<GitWorktreeMutationResult> => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      const status = await workspace.gitWorktree.getStatus();
      const count =
        status.kind === 'ok'
          ? new Set([...status.staged, ...status.unstaged].map((change) => change.path)).size
          : 0;
      const result = await workspace.gitWorktree.revertAll();
      if (!result.success) return err(result.error);
      telemetryService.capture('vcs_files_discarded', {
        count,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok({ sequences: result.data });
    } catch (error) {
      log.error('gitCtrl.revertAllFiles failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  commit: async (
    projectId: string,
    workspaceId: string,
    message: string
  ): Promise<GitWorktreeCommitResult> => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    return workspace.gitWorktree.commit(message);
  },

  push: async (projectId: string, workspaceId: string, remote: string) => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    const result = await workspace.gitWorktree.push(remote);
    telemetryService.capture('vcs_push', {
      success: result.success,
      project_id: projectId,
      task_id: workspaceId,
      ...(result.success ? {} : { error_type: result.error.type }),
    });
    return result;
  },

  pull: async (projectId: string, workspaceId: string) => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' as const });
    const result = await workspace.gitWorktree.pull();
    telemetryService.capture('vcs_pull', {
      success: result.success,
      project_id: projectId,
      task_id: workspaceId,
      ...(result.success ? {} : { error_type: result.error.type }),
    });
    return result;
  },

  getLog: async (
    projectId: string,
    workspaceId: string,
    maxCount?: number,
    skip?: number,
    knownAheadCount?: number,
    remote?: string,
    base?: GitObjectRef,
    head?: GitObjectRef
  ) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      const result = await workspace.gitWorktree.getLog({
        maxCount,
        skip,
        knownAheadCount,
        preferredRemote: remote,
        base,
        head,
      });
      return ok({ commits: result.commits, aheadCount: result.aheadCount });
    } catch (error) {
      log.error('gitCtrl.getLog failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },

  getCommitFiles: async (projectId: string, workspaceId: string, commitHash: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ files: await workspace.gitWorktree.getCommitFiles(commitHash) });
    } catch (error) {
      log.error('gitCtrl.getCommitFiles failed', { projectId, workspaceId, commitHash, error });
      return err({ type: 'git_error' as const, message: gitErrorMessage(error) });
    }
  },
});
