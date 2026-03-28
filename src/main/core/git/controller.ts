import type { DiffBase } from '@shared/git';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { resolveTask } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';

export const gitController = createRPCController({
  getStatus: async (projectId: string, taskId: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const changes = await env.git.getStatus();
      return ok({ changes });
    } catch (e) {
      log.error('gitCtrl.getStatus failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getChangedFiles: async (projectId: string, taskId: string, base: DiffBase) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const changes = await env.git.getChangedFiles(base);
      return ok({ changes });
    } catch (e) {
      log.error('gitCtrl.getChangedFiles failed', { projectId, taskId, base, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileAtHead: async (projectId: string, taskId: string, filePath: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const content = await env.git.getFileAtHead(filePath);
      return ok({ content });
    } catch (e) {
      log.error('gitCtrl.getFileAtHead failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileAtRef: async (projectId: string, taskId: string, filePath: string, ref: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const content = await env.git.getFileAtRef(filePath, ref);
      return ok({ content });
    } catch (e) {
      log.error('gitCtrl.getFileAtRef failed', { projectId, taskId, filePath, ref, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileAtIndex: async (projectId: string, taskId: string, filePath: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const content = await env.git.getFileAtIndex(filePath);
      return ok({ content });
    } catch (e) {
      log.error('gitCtrl.getFileAtIndex failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileDiff: async (projectId: string, taskId: string, filePath: string, base?: DiffBase) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const diff = await env.git.getFileDiff(filePath, base);
      return ok({ diff });
    } catch (e) {
      log.error('gitCtrl.getFileDiff failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageFile: async (projectId: string, taskId: string, filePath: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.stageFiles([filePath]);
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageFile failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageFiles: async (projectId: string, taskId: string, filePaths: string[]) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.stageFiles(filePaths);
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageFiles failed', { projectId, taskId, filePaths, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageAllFiles: async (projectId: string, taskId: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.stageAllFiles();
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageAllFiles failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageFile: async (projectId: string, taskId: string, filePath: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.unstageFiles([filePath]);
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageFile failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageFiles: async (projectId: string, taskId: string, filePaths: string[]) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.unstageFiles(filePaths);
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageFiles failed', { projectId, taskId, filePaths, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageAllFiles: async (projectId: string, taskId: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.unstageAllFiles();
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageAllFiles failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertFile: async (projectId: string, taskId: string, filePath: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.revertFiles([filePath]);
      return ok();
    } catch (e) {
      log.error('gitCtrl.revertFile failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertFiles: async (projectId: string, taskId: string, filePaths: string[]) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.revertFiles(filePaths);
      return ok();
    } catch (e) {
      log.error('gitCtrl.revertFiles failed', { projectId, taskId, filePaths, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertAllFiles: async (projectId: string, taskId: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.revertAllFiles();
      return ok();
    } catch (e) {
      log.error('gitCtrl.revertAllFiles failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  commit: async (projectId: string, taskId: string, message: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.commit(message);
    if (!result.success) return err(result.error);
    return ok({ hash: result.data.hash });
  },

  fetch: async (projectId: string, taskId: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.fetch();
    if (!result.success) return err(result.error);
    return ok();
  },

  push: async (projectId: string, taskId: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.push();
    if (!result.success) return err(result.error);
    return ok({ output: result.data.output });
  },

  publishBranch: async (projectId: string, taskId: string, branchName: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.publishBranch(branchName);
    if (!result.success) return err(result.error);
    return ok({ output: result.data.output });
  },

  pull: async (projectId: string, taskId: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.pull();
    if (!result.success) return err(result.error);
    return ok({ output: result.data.output });
  },

  softReset: async (projectId: string, taskId: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.softReset();
    if (!result.success) return err(result.error);
    return ok({ subject: result.data.subject, body: result.data.body });
  },

  getLog: async (
    projectId: string,
    taskId: string,
    maxCount?: number,
    skip?: number,
    knownAheadCount?: number
  ) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const result = await env.git.getLog({ maxCount, skip, knownAheadCount });
      return ok({ commits: result.commits, aheadCount: result.aheadCount });
    } catch (e) {
      log.error('gitCtrl.getLog failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getLatestCommit: async (projectId: string, taskId: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const commit = await env.git.getLatestCommit();
      return ok({ commit });
    } catch (e) {
      log.error('gitCtrl.getLatestCommit failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getCommitFiles: async (projectId: string, taskId: string, commitHash: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const files = await env.git.getCommitFiles(commitHash);
      return ok({ files });
    } catch (e) {
      log.error('gitCtrl.getCommitFiles failed', { projectId, taskId, commitHash, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getCommitFileDiff: async (
    projectId: string,
    taskId: string,
    commitHash: string,
    filePath: string
  ) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const diff = await env.git.getCommitFileDiff(commitHash, filePath);
      return ok({ diff });
    } catch (e) {
      log.error('gitCtrl.getCommitFileDiff failed', {
        projectId,
        taskId,
        commitHash,
        filePath,
        error: e,
      });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getBranchStatus: async (projectId: string, taskId: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const status = await env.git.getBranchStatus();
      return ok(status);
    } catch (e) {
      log.error('gitCtrl.getBranchStatus failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getBranches: async (projectId: string, taskId: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const branches = await env.git.getBranches();
      return ok({ branches });
    } catch (e) {
      log.error('gitCtrl.getBranches failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getDefaultBranch: async (projectId: string, taskId: string) => {
    try {
      const env = resolveTask(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const defaultBranch = await env.git.getDefaultBranch();
      return ok(defaultBranch);
    } catch (e) {
      log.error('gitCtrl.getDefaultBranch failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  renameBranch: async (projectId: string, taskId: string, oldBranch: string, newBranch: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env) return err({ type: 'not_found' as const });
    const result = await env.git.renameBranch(oldBranch, newBranch);
    if (!result.success) return err(result.error);
    return ok({ remotePushed: result.data.remotePushed });
  },
});
