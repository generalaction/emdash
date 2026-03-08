import { planEventChannel } from '../../shared/events/appEvents';
import { createRPCController } from '../../shared/ipc/rpc';
import { events } from '../lib/events';
import { err, ok } from '../lib/result';
import {
  FileSystemErrorCodes,
  type ListOptions,
  type SearchOptions,
} from '../workspaces/impl/fs-provider/types';
import { environmentProviderManager } from '../workspaces/provider-manager';

function resolveEnv(projectId: string, taskId: string) {
  return environmentProviderManager.getProvider(projectId)?.getEnvironment(taskId) ?? null;
}

export const filesController = createRPCController({
  listFiles: async (projectId: string, taskId: string, dirPath: string, options?: ListOptions) => {
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
    const env = resolveEnv(projectId, taskId);
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
});
