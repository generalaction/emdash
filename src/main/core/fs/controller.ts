import { planEventChannel } from '@shared/events/appEvents';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { events } from '@main/lib/events';
import { resolveTask } from '../projects/utils';
import {
  FileSystemErrorCodes,
  type FileWatcher,
  type ListOptions,
  type SearchOptions,
} from './types';

// One watcher per (projectId, workspaceId) pair, shared across all consumers via labels.
// Local: single recursive @parcel/watcher subscription — update() is a no-op.
// SSH:   poll-based — update() receives the union of all labels' paths to poll.
const watcherRegistry = new Map<string, FileWatcher>();
// Per-label path groups, keyed by `${projectId}::${workspaceId}` → namespaced label → paths.
// Paths are forwarded to update() for SSH compatibility; local ignores them.
const watcherLabeledPaths = new Map<string, Map<string, string[]>>();
// Task-to-workspace watcher lookup so watchStop can resolve the active watcher key.
const taskWatcherKeys = new Map<string, string>();

export const filesController = createRPCController({
  listFiles: async (projectId: string, taskId: string, dirPath: string, options?: ListOptions) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.workspace.fs.list(dirPath, options);
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
      const result = await env.workspace.fs.read(filePath, maxBytes);
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
      const result = await env.workspace.fs.write(filePath, content);
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

    if (!env.workspace.fs.remove) {
      return err({
        type: 'fs_error' as const,
        message: 'remove not supported by this filesystem',
      });
    }

    try {
      const result = await env.workspace.fs.remove(filePath);
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

    if (!env.workspace.fs.readImage) {
      return err({
        type: 'fs_error' as const,
        message: 'readImage not supported by this filesystem',
      });
    }

    try {
      const result = await env.workspace.fs.readImage(filePath);
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
      const result = await env.workspace.fs.search(query, options);
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
      const entry = await env.workspace.fs.stat(filePath);
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
      const exists = await env.workspace.fs.exists(filePath);
      return ok({ exists });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  getProjectConfig: async (projectId: string, taskId: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.workspace.fs.getProjectConfig) {
      return err({
        type: 'fs_error' as const,
        message: 'getProjectConfig not supported by this filesystem',
      });
    }

    try {
      const result = await env.workspace.fs.getProjectConfig();
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  saveProjectConfig: async (projectId: string, taskId: string, content: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.workspace.fs.saveProjectConfig) {
      return err({
        type: 'fs_error' as const,
        message: 'saveProjectConfig not supported by this filesystem',
      });
    }

    try {
      const result = await env.workspace.fs.saveProjectConfig(content);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  saveAttachment: async (projectId: string, taskId: string, srcPath: string, subdir?: string) => {
    const env = resolveTask(projectId, taskId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.workspace.fs.saveAttachment) {
      return err({
        type: 'fs_error' as const,
        message: 'saveAttachment not supported by this filesystem',
      });
    }

    try {
      const result = await env.workspace.fs.saveAttachment(srcPath, subdir);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  watchSetPaths: async (projectId: string, taskId: string, paths: string[], label = 'default') => {
    const env = resolveTask(projectId, taskId);
    if (!env) {
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });
    }

    if (!env.workspace.fs.watch) {
      return ok({ supported: false as const });
    }

    const workspaceId = env.workspace.id;
    const key = `${projectId}::${workspaceId}`;
    const namespacedLabel = `${taskId}::${label}`;
    taskWatcherKeys.set(`${projectId}::${taskId}`, key);

    const groups = watcherLabeledPaths.get(key) ?? new Map<string, string[]>();
    groups.set(namespacedLabel, paths);
    watcherLabeledPaths.set(key, groups);
    const union = [...new Set([...groups.values()].flat())];

    const existing = watcherRegistry.get(key);
    if (existing) {
      // For SSH: update the union of watched paths across all labels.
      // For local: update() is a no-op since the recursive watcher covers everything.
      existing.update(union);
    } else {
      const watcher = env.workspace.fs.watch((evts) => {
        events.emit(fsWatchEventChannel, { projectId, workspaceId, events: evts }, workspaceId);
      });
      watcher.update(union);
      watcherRegistry.set(key, watcher);
    }
    return ok({ supported: true as const });
  },

  watchStop: async (projectId: string, taskId: string, label = 'default') => {
    const taskKey = `${projectId}::${taskId}`;
    const key = taskWatcherKeys.get(taskKey);
    if (!key) return ok({});

    const namespacedLabel = `${taskId}::${label}`;
    const groups = watcherLabeledPaths.get(key);
    groups?.delete(namespacedLabel);

    const stillHasTaskLabels =
      groups &&
      Array.from(groups.keys()).some((currentLabel) => currentLabel.startsWith(`${taskId}::`));
    if (!stillHasTaskLabels) {
      taskWatcherKeys.delete(taskKey);
    }

    if (!groups?.size) {
      watcherLabeledPaths.delete(key);
      watcherRegistry.get(key)?.close();
      watcherRegistry.delete(key);
      for (const [taskMapKey, watcherKey] of taskWatcherKeys) {
        if (watcherKey === key) {
          taskWatcherKeys.delete(taskMapKey);
        }
      }
    } else {
      const union = [...new Set([...groups.values()].flat())];
      watcherRegistry.get(key)?.update(union);
    }
    return ok({});
  },
});
