import type { DiffTarget, GitObjectRef } from '@emdash/core/git';
import { resolveWorkspace } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type {
  GitWorktreeCommitResult,
  GitWorktreeMutationResult,
  GitWorktreeSnapshotResult,
} from '@shared/core/git/rpc';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { err, ok } from '@shared/lib/result';
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
      return err({ type: 'git_error', message: String(error) });
    }
  },

  getChangedFiles: async (projectId: string, workspaceId: string, base: DiffTarget) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ changes: await workspace.gitWorktree.getChangedFiles(base) });
    } catch (error) {
      log.error('gitCtrl.getChangedFiles failed', { projectId, workspaceId, base, error });
      return err({ type: 'git_error' as const, message: String(error) });
    }
  },

  getFileAtRef: async (projectId: string, workspaceId: string, filePath: string, ref: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ content: await workspace.gitWorktree.getFileAtRef(filePath, ref) });
    } catch (error) {
      log.error('gitCtrl.getFileAtRef failed', { projectId, workspaceId, filePath, ref, error });
      return err({ type: 'git_error' as const, message: String(error) });
    }
  },

  getFileAtIndex: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ content: await workspace.gitWorktree.getFileAtIndex(filePath) });
    } catch (error) {
      log.error('gitCtrl.getFileAtIndex failed', { projectId, workspaceId, filePath, error });
      return err({ type: 'git_error' as const, message: String(error) });
    }
  },

  getImageAtRef: async (projectId: string, workspaceId: string, filePath: string, ref: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ result: await workspace.gitWorktree.getImageAtRef(filePath, ref) });
    } catch (error) {
      log.error('gitCtrl.getImageAtRef failed', { projectId, workspaceId, filePath, ref, error });
      return err({ type: 'git_error' as const, message: String(error) });
    }
  },

  getImageAtIndex: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ result: await workspace.gitWorktree.getImageAtIndex(filePath) });
    } catch (error) {
      log.error('gitCtrl.getImageAtIndex failed', { projectId, workspaceId, filePath, error });
      return err({ type: 'git_error' as const, message: String(error) });
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
      const sequences = await workspace.gitWorktree.stageAll();
      telemetryService.capture('vcs_files_staged', {
        count,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok({ sequences });
    } catch (error) {
      log.error('gitCtrl.stageAllFiles failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: String(error) });
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
      const sequences = await workspace.gitWorktree.unstageAll();
      telemetryService.capture('vcs_files_unstaged', {
        count,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok({ sequences });
    } catch (error) {
      log.error('gitCtrl.unstageAllFiles failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: String(error) });
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
      const sequences = await workspace.gitWorktree.revertAll();
      telemetryService.capture('vcs_files_discarded', {
        count,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok({ sequences });
    } catch (error) {
      log.error('gitCtrl.revertAllFiles failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: String(error) });
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
      return err({ type: 'git_error' as const, message: String(error) });
    }
  },

  getCommitFiles: async (projectId: string, workspaceId: string, commitHash: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ files: await workspace.gitWorktree.getCommitFiles(commitHash) });
    } catch (error) {
      log.error('gitCtrl.getCommitFiles failed', { projectId, workspaceId, commitHash, error });
      return err({ type: 'git_error' as const, message: String(error) });
    }
  },
});
