import { createRPCController } from '../../../shared/ipc/rpc';
import { db } from '../db/client';
import { projects, tasks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ok, err } from '../../lib/result';
import { log } from '../lib/logger';
import { taskResourceManager } from '../environment/task-resource-manager';

async function resolveTask(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return { task: null, project: null };

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .limit(1);
  if (!project) return { task, project: null };

  return { task, project };
}

export const gitCtrlController = createRPCController({
  getStatus: async (taskId: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const changes = await env.git.getStatus(task.path);
      return ok({ changes });
    } catch (e) {
      log.error('gitCtrl.getStatus failed', { taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getFileDiff: async (taskId: string, filePath: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const diff = await env.git.getFileDiff(task.path, filePath);
      return ok({ diff });
    } catch (e) {
      log.error('gitCtrl.getFileDiff failed', { taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageFile: async (taskId: string, filePath: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      await env.git.stageFile(task.path, filePath);
      return ok(undefined);
    } catch (e) {
      log.error('gitCtrl.stageFile failed', { taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  stageAllFiles: async (taskId: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      await env.git.stageAllFiles(task.path);
      return ok(undefined);
    } catch (e) {
      log.error('gitCtrl.stageAllFiles failed', { taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  unstageFile: async (taskId: string, filePath: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      await env.git.unstageFile(task.path, filePath);
      return ok(undefined);
    } catch (e) {
      log.error('gitCtrl.unstageFile failed', { taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  revertFile: async (taskId: string, filePath: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const result = await env.git.revertFile(task.path, filePath);
      return ok({ action: result.action });
    } catch (e) {
      log.error('gitCtrl.revertFile failed', { taskId, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  commit: async (taskId: string, message: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const result = await env.git.commit(task.path, message);
      return ok({ hash: result.hash });
    } catch (e) {
      log.error('gitCtrl.commit failed', { taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  push: async (taskId: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const result = await env.git.push(task.path);
      return ok({ output: result.output });
    } catch (e) {
      log.error('gitCtrl.push failed', { taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  pull: async (taskId: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const result = await env.git.pull(task.path);
      return ok({ output: result.output });
    } catch (e) {
      log.error('gitCtrl.pull failed', { taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  softReset: async (taskId: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const result = await env.git.softReset(task.path);
      return ok({ subject: result.subject, body: result.body });
    } catch (e) {
      log.error('gitCtrl.softReset failed', { taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getLog: async (taskId: string, maxCount?: number, skip?: number, aheadCount?: number) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const result = await env.git.getLog(task.path, maxCount, skip, aheadCount);
      return ok({ commits: result.commits, aheadCount: result.aheadCount });
    } catch (e) {
      log.error('gitCtrl.getLog failed', { taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getLatestCommit: async (taskId: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const commit = await env.git.getLatestCommit(task.path);
      return ok({ commit });
    } catch (e) {
      log.error('gitCtrl.getLatestCommit failed', { taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getCommitFiles: async (taskId: string, commitHash: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const files = await env.git.getCommitFiles(task.path, commitHash);
      return ok({ files });
    } catch (e) {
      log.error('gitCtrl.getCommitFiles failed', { taskId, commitHash, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getCommitFileDiff: async (taskId: string, commitHash: string, filePath: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const diff = await env.git.getCommitFileDiff(task.path, commitHash, filePath);
      return ok({ diff });
    } catch (e) {
      log.error('gitCtrl.getCommitFileDiff failed', { taskId, commitHash, filePath, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getBranchStatus: async (taskId: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const status = await env.git.getBranchStatus(task.path);
      return ok(status);
    } catch (e) {
      log.error('gitCtrl.getBranchStatus failed', { taskId, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  renameBranch: async (taskId: string, oldBranch: string, newBranch: string) => {
    try {
      const { task, project } = await resolveTask(taskId);
      if (!task || !project) return err({ type: 'not_found' as const });
      const env = await taskResourceManager.getOrProvision(project, task);
      const result = await env.git.renameBranch(task.path, oldBranch, newBranch);
      return ok({ remotePushed: result.remotePushed });
    } catch (e) {
      log.error('gitCtrl.renameBranch failed', { taskId, oldBranch, newBranch, error: e });
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },
});
