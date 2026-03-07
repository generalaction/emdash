import { createRPCController } from '../../../shared/ipc/rpc';
import { db } from '../db/client';
import { projects, tasks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ok, err } from '../../lib/result';
import { taskResourceManager } from '../environment/task-resource-manager';
import type { ListOptions, SearchOptions } from '../services/fs/types';

async function resolveTaskEnv(taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return { env: null, notFound: 'task' as const };

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .limit(1);
  if (!project) return { env: null, notFound: 'project' as const };

  try {
    const env = await taskResourceManager.getOrProvision(project, task);
    return { env, notFound: null };
  } catch (e) {
    return { env: null, notFound: 'filesystem' as const, initError: String(e) };
  }
}

export const filesController = createRPCController({
  listFiles: async (taskId: string, dirPath: string, options?: ListOptions) => {
    const { env, notFound, initError } = await resolveTaskEnv(taskId);
    if (!env) return err({ type: 'not_found' as const, entity: notFound!, detail: initError });

    try {
      const result = await env.fs.list(dirPath, options);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  readFile: async (taskId: string, filePath: string, maxBytes?: number) => {
    const { env, notFound, initError } = await resolveTaskEnv(taskId);
    if (!env) return err({ type: 'not_found' as const, entity: notFound!, detail: initError });

    try {
      const result = await env.fs.read(filePath, maxBytes);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  writeFile: async (taskId: string, filePath: string, content: string) => {
    const { env, notFound, initError } = await resolveTaskEnv(taskId);
    if (!env) return err({ type: 'not_found' as const, entity: notFound!, detail: initError });

    try {
      const result = await env.fs.write(filePath, content);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  searchFiles: async (taskId: string, query: string, options?: SearchOptions) => {
    const { env, notFound, initError } = await resolveTaskEnv(taskId);
    if (!env) return err({ type: 'not_found' as const, entity: notFound!, detail: initError });

    try {
      const result = await env.fs.search(query, options);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  statFile: async (taskId: string, filePath: string) => {
    const { env, notFound, initError } = await resolveTaskEnv(taskId);
    if (!env) return err({ type: 'not_found' as const, entity: notFound!, detail: initError });

    try {
      const entry = await env.fs.stat(filePath);
      return ok({ entry });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  fileExists: async (taskId: string, filePath: string) => {
    const { env, notFound, initError } = await resolveTaskEnv(taskId);
    if (!env) return err({ type: 'not_found' as const, entity: notFound!, detail: initError });

    try {
      const exists = await env.fs.exists(filePath);
      return ok({ exists });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },
});
