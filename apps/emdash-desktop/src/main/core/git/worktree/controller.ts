import type { DiffTarget, GitObjectRef } from '@emdash/shared/git';
import { resolveWorkspace } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { err, ok } from '@shared/lib/result';

export const gitWorktreeController = createRPCController({
  getWorktreeSnapshot: async (projectId: string, workspaceId: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok(await workspace.gitWorktree.getSnapshot());
    } catch (error) {
      log.error('gitCtrl.getWorktreeSnapshot failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: String(error) });
    }
  },

  getFullStatus: async (projectId: string, workspaceId: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      const [status, head] = await Promise.all([
        workspace.gitWorktree.getStatus(),
        workspace.gitWorktree.getHead(),
      ]);
      if (status.kind === 'too-many-files') return err({ type: 'too_many_files' as const });
      if (status.kind === 'error')
        return err({ type: 'git_error' as const, message: status.message });
      return ok({
        staged: status.staged,
        unstaged: status.unstaged,
        currentBranch: head.kind === 'detached' ? null : head.name,
        headKind: head.kind,
        shortHash: head.kind === 'detached' ? head.shortHash : null,
        totalAdded: status.stagedAdded,
        totalDeleted: status.stagedDeleted,
      });
    } catch (error) {
      log.error('gitCtrl.getFullStatus failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: String(error) });
    }
  },

  getStatus: async (projectId: string, workspaceId: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      const [status, head] = await Promise.all([
        workspace.gitWorktree.getStatus(),
        workspace.gitWorktree.getHead(),
      ]);
      if (status.kind === 'too-many-files') return err({ type: 'too_many_files' as const });
      if (status.kind === 'error')
        return err({ type: 'git_error' as const, message: status.message });
      return ok({
        changes: mergeChanges(status.staged, status.unstaged),
        currentBranch: head.kind === 'detached' ? null : head.name,
      });
    } catch (error) {
      log.error('gitCtrl.getStatus failed', { projectId, workspaceId, error });
      return err({ type: 'git_error' as const, message: String(error) });
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

  getFileAtHead: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      return ok({ content: await workspace.gitWorktree.getFileAtRef(filePath, 'HEAD') });
    } catch (error) {
      log.error('gitCtrl.getFileAtHead failed', { projectId, workspaceId, filePath, error });
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

  stageFile: async (projectId: string, workspaceId: string, filePath: string) => {
    return stage(projectId, workspaceId, [filePath], 'single');
  },

  stageFiles: async (projectId: string, workspaceId: string, filePaths: string[]) => {
    return stage(projectId, workspaceId, filePaths, filePaths.length === 1 ? 'single' : 'multiple');
  },

  stageAllFiles: async (projectId: string, workspaceId: string) => {
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

  unstageFile: async (projectId: string, workspaceId: string, filePath: string) => {
    return unstage(projectId, workspaceId, [filePath], 'single');
  },

  unstageFiles: async (projectId: string, workspaceId: string, filePaths: string[]) => {
    return unstage(
      projectId,
      workspaceId,
      filePaths,
      filePaths.length === 1 ? 'single' : 'multiple'
    );
  },

  unstageAllFiles: async (projectId: string, workspaceId: string) => {
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

  revertFile: async (projectId: string, workspaceId: string, filePath: string) => {
    return revert(projectId, workspaceId, [filePath], 'single');
  },

  revertFiles: async (projectId: string, workspaceId: string, filePaths: string[]) => {
    return revert(
      projectId,
      workspaceId,
      filePaths,
      filePaths.length === 1 ? 'single' : 'multiple'
    );
  },

  revertAllFiles: async (projectId: string, workspaceId: string) => {
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

  commit: async (projectId: string, workspaceId: string, message: string) => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' as const });
    return workspace.gitWorktree.commit(message);
  },

  push: async (projectId: string, workspaceId: string, remote: string) => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' as const });
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

  getLatestCommit: async (projectId: string, workspaceId: string) => {
    try {
      const workspace = resolveWorkspace(projectId, workspaceId);
      if (!workspace) return err({ type: 'not_found' as const });
      const result = await workspace.gitWorktree.getLog({ maxCount: 1 });
      return ok({ commit: result.commits[0] ?? null });
    } catch (error) {
      log.error('gitCtrl.getLatestCommit failed', { projectId, workspaceId, error });
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

async function stage(
  projectId: string,
  workspaceId: string,
  paths: string[],
  scope: 'single' | 'multiple'
) {
  try {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' as const });
    const sequences = await workspace.gitWorktree.stage(paths);
    telemetryService.capture('vcs_files_staged', {
      count: paths.length,
      scope,
      project_id: projectId,
      task_id: workspaceId,
    });
    return ok({ sequences });
  } catch (error) {
    log.error('gitCtrl.stage failed', { projectId, workspaceId, paths, error });
    return err({ type: 'git_error' as const, message: String(error) });
  }
}

async function unstage(
  projectId: string,
  workspaceId: string,
  paths: string[],
  scope: 'single' | 'multiple'
) {
  try {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' as const });
    const sequences = await workspace.gitWorktree.unstage(paths);
    telemetryService.capture('vcs_files_unstaged', {
      count: paths.length,
      scope,
      project_id: projectId,
      task_id: workspaceId,
    });
    return ok({ sequences });
  } catch (error) {
    log.error('gitCtrl.unstage failed', { projectId, workspaceId, paths, error });
    return err({ type: 'git_error' as const, message: String(error) });
  }
}

async function revert(
  projectId: string,
  workspaceId: string,
  paths: string[],
  scope: 'single' | 'multiple'
) {
  try {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' as const });
    const sequences = await workspace.gitWorktree.revert(paths);
    telemetryService.capture('vcs_files_discarded', {
      count: paths.length,
      scope,
      project_id: projectId,
      task_id: workspaceId,
    });
    return ok({ sequences });
  } catch (error) {
    log.error('gitCtrl.revert failed', { projectId, workspaceId, paths, error });
    return err({ type: 'git_error' as const, message: String(error) });
  }
}

function mergeChanges(
  staged: Array<{ path: string; additions: number; deletions: number; status: string }>,
  unstaged: Array<{ path: string; additions: number; deletions: number; status: string }>
) {
  const byPath = new Map<
    string,
    { path: string; additions: number; deletions: number; status: string }
  >();
  for (const change of staged) byPath.set(change.path, change);
  for (const change of unstaged) {
    const previous = byPath.get(change.path);
    if (previous) {
      byPath.set(change.path, {
        path: change.path,
        status: change.status,
        additions: previous.additions + change.additions,
        deletions: previous.deletions + change.deletions,
      });
    } else {
      byPath.set(change.path, change);
    }
  }
  return [...byPath.values()];
}
