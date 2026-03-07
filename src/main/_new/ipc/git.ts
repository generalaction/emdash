import { createRPCController } from '../../../shared/ipc/rpc';
import { ok, err } from '../../_deprecated/lib/result';
import { log } from '../lib/logger';
import { environmentProviderManager } from '../environment/provider-manager';

function resolveEnv(projectId: string, taskId: string) {
  const env = environmentProviderManager.getProvider(projectId)?.getEnvironment(taskId);
  return env ?? null;
}

export const gitCtrlController = createRPCController({
  getStatus: async (projectId: string, taskId: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const changes = await env.git.getStatus();
      return ok({ changes });
    } catch (e) {
      log.error('gitCtrl.getStatus failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileDiff: async (projectId: string, taskId: string, filePath: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const diff = await env.git.getFileDiff(filePath);
      return ok({ diff });
    } catch (e) {
      log.error('gitCtrl.getFileDiff failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageFile: async (projectId: string, taskId: string, filePath: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.stageFile(filePath);
      return ok();
    } catch (e) {
      log.error('gitCtrl.stageFile failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageAllFiles: async (projectId: string, taskId: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
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
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      await env.git.unstageFile(filePath);
      return ok();
    } catch (e) {
      log.error('gitCtrl.unstageFile failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertFile: async (projectId: string, taskId: string, filePath: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const result = await env.git.revertFile(filePath);
      return ok({ action: result.action });
    } catch (e) {
      log.error('gitCtrl.revertFile failed', { projectId, taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  commit: async (projectId: string, taskId: string, message: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const result = await env.git.commit(message);
      return ok({ hash: result.hash });
    } catch (e) {
      log.error('gitCtrl.commit failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  push: async (projectId: string, taskId: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const result = await env.git.push();
      return ok({ output: result.output });
    } catch (e) {
      log.error('gitCtrl.push failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  pull: async (projectId: string, taskId: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const result = await env.git.pull();
      return ok({ output: result.output });
    } catch (e) {
      log.error('gitCtrl.pull failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  softReset: async (projectId: string, taskId: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const result = await env.git.softReset();
      return ok({ subject: result.subject, body: result.body });
    } catch (e) {
      log.error('gitCtrl.softReset failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getLog: async (
    projectId: string,
    taskId: string,
    maxCount?: number,
    skip?: number,
    aheadCount?: number
  ) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const result = await env.git.getLog(maxCount, skip, aheadCount);
      return ok({ commits: result.commits, aheadCount: result.aheadCount });
    } catch (e) {
      log.error('gitCtrl.getLog failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getLatestCommit: async (projectId: string, taskId: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
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
      const env = resolveEnv(projectId, taskId);
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
      const env = resolveEnv(projectId, taskId);
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
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const status = await env.git.getBranchStatus();
      return ok(status);
    } catch (e) {
      log.error('gitCtrl.getBranchStatus failed', { projectId, taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  renameBranch: async (projectId: string, taskId: string, oldBranch: string, newBranch: string) => {
    try {
      const env = resolveEnv(projectId, taskId);
      if (!env) return err({ type: 'not_found' as const });
      const result = await env.git.renameBranch(env.taskPath, oldBranch, newBranch);
      return ok({ remotePushed: result.remotePushed });
    } catch (e) {
      log.error('gitCtrl.renameBranch failed', {
        projectId,
        taskId,
        oldBranch,
        newBranch,
        error: e,
      });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },
});
