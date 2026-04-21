import type { DiffMode, GitObjectRef, GitRef, MergeBaseRange } from '@shared/git';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { TooManyFilesChangedError } from '@main/core/git/impl/status-parser';
import { resolveWorkspace } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';

export const gitController = createRPCController({
  getFullStatus: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const data = await env.git.getFullStatus();
      return ok(data);
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) {
        return err({ type: 'too_many_files' as const });
      }
      log.error('gitCtrl.getFullStatus failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getStatus: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const { changes, currentBranch } = await env.git.getStatus();
      return ok({ changes, currentBranch });
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) {
        return err({ type: 'too_many_files' as const });
      }
      log.error('gitCtrl.getStatus failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getStagedChanges: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const data = await env.git.getStagedChanges();
      return ok(data);
    } catch (e) {
      log.error('gitCtrl.getStagedChanges failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getUnstagedChanges: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const data = await env.git.getUnstagedChanges();
      return ok(data);
    } catch (e) {
      log.error('gitCtrl.getUnstagedChanges failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getCurrentBranch: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const currentBranch = await env.git.getCurrentBranch();
      return ok({ currentBranch });
    } catch (e) {
      log.error('gitCtrl.getCurrentBranch failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getChangedFiles: async (
    projectId: string,
    workspaceId: string,
    base: DiffMode | GitObjectRef | MergeBaseRange
  ) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const changes = await env.git.getChangedFiles(base);
      return ok({ changes });
    } catch (e) {
      log.error('gitCtrl.getChangedFiles failed', { projectId, workspaceId, base, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileAtHead: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const content = await env.git.getFileAtHead(filePath);
      return ok({ content });
    } catch (e) {
      log.error('gitCtrl.getFileAtHead failed', { projectId, workspaceId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileAtRef: async (projectId: string, workspaceId: string, filePath: string, ref: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const content = await env.git.getFileAtRef(filePath, ref);
      return ok({ content });
    } catch (e) {
      log.error('gitCtrl.getFileAtRef failed', { projectId, workspaceId, filePath, ref, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileAtIndex: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const content = await env.git.getFileAtIndex(filePath);
      return ok({ content });
    } catch (e) {
      log.error('gitCtrl.getFileAtIndex failed', { projectId, workspaceId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileDiff: async (projectId: string, workspaceId: string, filePath: string, base?: GitRef) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const diff = await env.git.getFileDiff(filePath, base);
      return ok({ diff });
    } catch (e) {
      log.error('gitCtrl.getFileDiff failed', { projectId, workspaceId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageFile: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.stageFiles([filePath]);
      capture('vcs_files_staged', {
        count: 1,
        scope: 'single',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageFile failed', { projectId, workspaceId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageFiles: async (projectId: string, workspaceId: string, filePaths: string[]) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.stageFiles(filePaths);
      capture('vcs_files_staged', {
        count: filePaths.length,
        scope: filePaths.length === 1 ? 'single' : 'multiple',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageFiles failed', { projectId, workspaceId, filePaths, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageAllFiles: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const unstaged = await env.git.getUnstagedChanges();
      await env.git.stageAllFiles();
      capture('vcs_files_staged', {
        count: unstaged.changes.length,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageAllFiles failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageFile: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.unstageFiles([filePath]);
      capture('vcs_files_unstaged', {
        count: 1,
        scope: 'single',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageFile failed', { projectId, workspaceId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageFiles: async (projectId: string, workspaceId: string, filePaths: string[]) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.unstageFiles(filePaths);
      capture('vcs_files_unstaged', {
        count: filePaths.length,
        scope: filePaths.length === 1 ? 'single' : 'multiple',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageFiles failed', { projectId, workspaceId, filePaths, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageAllFiles: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const staged = await env.git.getStagedChanges();
      await env.git.unstageAllFiles();
      capture('vcs_files_unstaged', {
        count: staged.changes.length,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageAllFiles failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertFile: async (projectId: string, workspaceId: string, filePath: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.revertFiles([filePath]);
      capture('vcs_files_discarded', {
        count: 1,
        scope: 'single',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.revertFile failed', { projectId, workspaceId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertFiles: async (projectId: string, workspaceId: string, filePaths: string[]) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.revertFiles(filePaths);
      capture('vcs_files_discarded', {
        count: filePaths.length,
        scope: filePaths.length === 1 ? 'single' : 'multiple',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.revertFiles failed', { projectId, workspaceId, filePaths, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertAllFiles: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const status = await env.git.getStatus();
      const changedCount = new Set(status.changes.map((change) => change.path)).size;
      await env.git.revertAllFiles();
      capture('vcs_files_discarded', {
        count: changedCount,
        scope: 'all',
        project_id: projectId,
        task_id: workspaceId,
      });
      return ok();
    } catch (e) {
      log.error('gitCtrl.revertAllFiles failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  commit: async (projectId: string, workspaceId: string, message: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.commit(message);
    if (!result.success) return err(result.error);
    return ok({ hash: result.data.hash });
  },

  push: async (projectId: string, workspaceId: string, remote: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.push(remote);
    capture('vcs_push', {
      success: result.success,
      project_id: projectId,
      task_id: workspaceId,
      ...(result.success ? {} : { error_type: result.error.type }),
    });
    if (!result.success) return err(result.error);
    return ok({ output: result.data.output });
  },

  publishBranch: async (
    projectId: string,
    workspaceId: string,
    branchName: string,
    remote: string
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.publishBranch(branchName, remote);
    capture('vcs_branch_published', {
      success: result.success,
      project_id: projectId,
      task_id: workspaceId,
      ...(result.success ? {} : { error_type: result.error.type }),
    });
    if (!result.success) return err(result.error);
    return ok({ output: result.data.output });
  },

  pull: async (projectId: string, workspaceId: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.pull();
    capture('vcs_pull', {
      success: result.success,
      project_id: projectId,
      task_id: workspaceId,
      ...(result.success
        ? {}
        : {
            error_type: result.error.type,
            conflicts: result.error.type === 'conflict',
          }),
    });
    if (!result.success) return err(result.error);
    return ok({ output: result.data.output });
  },

  softReset: async (projectId: string, workspaceId: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.softReset();
    if (!result.success) return err(result.error);
    return ok({ subject: result.data.subject, body: result.data.body });
  },

  getLog: async (
    projectId: string,
    workspaceId: string,
    maxCount?: number,
    skip?: number,
    knownAheadCount?: number,
    remote?: string,
    base?: GitObjectRef
  ) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const result = await env.git.getLog({
        maxCount,
        skip,
        knownAheadCount,
        preferredRemote: remote,
        base,
      });
      return ok({ commits: result.commits, aheadCount: result.aheadCount });
    } catch (e) {
      log.error('gitCtrl.getLog failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getLatestCommit: async (projectId: string, workspaceId: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const commit = await env.git.getLatestCommit();
      return ok({ commit });
    } catch (e) {
      log.error('gitCtrl.getLatestCommit failed', { projectId, workspaceId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getCommitFiles: async (projectId: string, workspaceId: string, commitHash: string) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const files = await env.git.getCommitFiles(commitHash);
      return ok({ files });
    } catch (e) {
      log.error('gitCtrl.getCommitFiles failed', { projectId, workspaceId, commitHash, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getCommitFileDiff: async (
    projectId: string,
    workspaceId: string,
    commitHash: string,
    filePath: string
  ) => {
    try {
      const env = resolveWorkspace(projectId, workspaceId);
      if (!env) return err({ type: 'not_found' as const });
      const diff = await env.git.getCommitFileDiff(commitHash, filePath);
      return ok({ diff });
    } catch (e) {
      log.error('gitCtrl.getCommitFileDiff failed', {
        projectId,
        workspaceId,
        commitHash,
        filePath,
        error: e,
      });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },
});
