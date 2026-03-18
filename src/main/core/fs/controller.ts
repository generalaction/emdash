import { planEventChannel } from '@shared/events/appEvents';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { createRPCController } from '@shared/ipc/rpc';
import { events } from '@main/lib/events';
import { err, ok } from '@main/lib/result';
import { resolveTask } from '../projects/utils';
import {
  FileSystemErrorCodes,
  type FileWatcher,
  type ListOptions,
  type SearchOptions,
} from './types';

const watcherRegistry = new Map<string, FileWatcher>();

export const filesController = createRPCController({
  listFiles: async (projectId: string, taskId: string, dirPath: string, options?: ListOptions) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.list(dirPath, options);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  readFile: async (projectId: string, taskId: string, filePath: string, maxBytes?: number) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.read(filePath, maxBytes);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  writeFile: async (projectId: string, taskId: string, filePath: string, content: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.write(filePath, content);
      return ok(result);
    } catch (e) {
      if (
        e instanceof Error &&
        (e as unknown as { code?: string }).code === FileSystemErrorCodes.PERMISSION_DENIED
      ) {
        events.emit(planEventChannel, {
          type: 'write_blocked' as const,
          root: projectId,
          relPath: filePath,
          message: e.message,
        });
      }
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  removeFile: async (projectId: string, taskId: string, filePath: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.remove) {
      return err({
        type: 'fs_error' as const,
        message: 'remove not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.remove(filePath);
      return ok(result);
    } catch (e) {
      if (
        e instanceof Error &&
        (e as unknown as { code?: string }).code === FileSystemErrorCodes.PERMISSION_DENIED
      ) {
        events.emit(planEventChannel, {
          type: 'remove_blocked' as const,
          root: projectId,
          relPath: filePath,
          message: e.message,
        });
      }
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  readImage: async (projectId: string, taskId: string, filePath: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.readImage) {
      return err({
        type: 'fs_error' as const,
        message: 'readImage not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.readImage(filePath);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  searchFiles: async (
    projectId: string,
    taskId: string,
    query: string,
    options?: SearchOptions
  ) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.search(query, options);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  statFile: async (projectId: string, taskId: string, filePath: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const entry = await env.fs.stat(filePath);
      return ok({ entry });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  fileExists: async (projectId: string, taskId: string, filePath: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const exists = await env.fs.exists(filePath);
      return ok({ exists });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  getProjectConfig: async (projectId: string, taskId: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.getProjectConfig) {
      return err({
        type: 'fs_error' as const,
        message: 'getProjectConfig not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.getProjectConfig();
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  saveProjectConfig: async (projectId: string, taskId: string, content: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.saveProjectConfig) {
      return err({
        type: 'fs_error' as const,
        message: 'saveProjectConfig not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.saveProjectConfig(content);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  saveAttachment: async (projectId: string, taskId: string, srcPath: string, subdir?: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.saveAttachment) {
      return err({
        type: 'fs_error' as const,
        message: 'saveAttachment not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.saveAttachment(srcPath, subdir);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  watchSetPaths: async (projectId: string, taskId: string, paths: string[]) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.watch) return ok({ supported: false as const });

    const key = `${projectId}::${taskId}`;
    const existing = watcherRegistry.get(key);
    if (existing) {
      existing.update(paths);
    } else {
      const watcher = env.fs.watch((evts) => {
        events.emit(fsWatchEventChannel, { projectId, taskId, events: evts }, taskId);
      });
      watcher.update(paths);
      watcherRegistry.set(key, watcher);
    }
    return ok({ supported: true as const });
  },

  watchStop: async (projectId: string, taskId: string) => {
    const key = `${projectId}::${taskId}`;
    watcherRegistry.get(key)?.close();
    watcherRegistry.delete(key);
    return ok({});
  },
});
