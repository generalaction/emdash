import { err, ok } from '@emdash/shared';
import { events } from '@main/lib/events';
import { planEventChannel } from '@shared/events/appEvents';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { resolveWorkspace } from '../../projects/utils';
import { fileErrorToMessage, isPermissionDenied } from './file-errors';
import { readWorkspaceImage } from './image-support';
import { copyLocalFilesToWorkspace } from './local-imports';
import {
  assertWorkspaceRemoveAllowed,
  assertWorkspaceWriteAllowed,
  resolveWorkspacePath,
} from './workspace-file-policy';

function resolveWorkspaceFiles(projectId: string, workspaceId: string) {
  const env = resolveWorkspace(projectId, workspaceId);
  if (!env)
    return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

  return ok({ env, fileSystem: env.fileSystem });
}

export const workspaceFileSystemController = createRPCController({
  readFile: async (projectId: string, workspaceId: string, filePath: string, maxBytes?: number) => {
    const resolved = resolveWorkspaceFiles(projectId, workspaceId);
    if (!resolved.success) return resolved;
    const { env, fileSystem } = resolved.data;

    const target = resolveWorkspacePath(env.path, filePath);
    if (!target.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(target.error) });
    }

    const result = await fileSystem.readText(target.data.path, { maxBytes });
    if (!result.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(result.error) });
    }
    return ok(result.data);
  },

  writeFile: async (projectId: string, workspaceId: string, filePath: string, content: string) => {
    const resolved = resolveWorkspaceFiles(projectId, workspaceId);
    if (!resolved.success) return resolved;
    const { env, fileSystem } = resolved.data;

    const target = await assertWorkspaceWriteAllowed(fileSystem, env.path, filePath);
    if (!target.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(target.error) });
    }

    const result = await fileSystem.writeText(target.data.path, content);
    if (!result.success) {
      if (isPermissionDenied(result.error)) {
        events.emit(planEventChannel, {
          type: 'write_blocked' as const,
          root: projectId,
          path: filePath,
          message: result.error.message,
        });
      }
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(result.error) });
    }
    return ok({ success: true as const, bytesWritten: result.data.bytesWritten });
  },

  removeFile: async (
    projectId: string,
    workspaceId: string,
    filePath: string,
    options?: { recursive?: boolean }
  ) => {
    const resolved = resolveWorkspaceFiles(projectId, workspaceId);
    if (!resolved.success) return resolved;
    const { env, fileSystem } = resolved.data;

    const target = await assertWorkspaceRemoveAllowed(fileSystem, env.path, filePath);
    if (!target.success) {
      return ok({ success: false as const, error: fileErrorToMessage(target.error) });
    }

    const result = await fileSystem.remove(target.data.path, options);
    if (!result.success) {
      if (isPermissionDenied(result.error)) {
        events.emit(planEventChannel, {
          type: 'remove_blocked' as const,
          root: projectId,
          path: filePath,
          message: result.error.message,
        });
      }
      return ok({ success: false as const, error: fileErrorToMessage(result.error) });
    }
    return ok({ success: true as const });
  },

  readImage: async (projectId: string, workspaceId: string, filePath: string) => {
    const resolved = resolveWorkspaceFiles(projectId, workspaceId);
    if (!resolved.success) return resolved;
    const { env, fileSystem } = resolved.data;

    const target = resolveWorkspacePath(env.path, filePath);
    if (!target.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(target.error) });
    }

    return await readWorkspaceImage(fileSystem, target.data.path);
  },

  fileExists: async (projectId: string, workspaceId: string, filePath: string) => {
    const resolved = resolveWorkspaceFiles(projectId, workspaceId);
    if (!resolved.success) return resolved;
    const { env, fileSystem } = resolved.data;

    const target = resolveWorkspacePath(env.path, filePath);
    if (!target.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(target.error) });
    }

    const result = await fileSystem.exists(target.data.path);
    if (!result.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(result.error) });
    }
    return ok({ exists: result.data });
  },

  getAbsolutePath: async (projectId: string, workspaceId: string, filePath: string) => {
    const resolved = resolveWorkspaceFiles(projectId, workspaceId);
    if (!resolved.success) return resolved;
    const { env, fileSystem } = resolved.data;

    const target = resolveWorkspacePath(env.path, filePath);
    if (!target.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(target.error) });
    }

    const result = await fileSystem.realPath(target.data.path);
    if (!result.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(result.error) });
    }
    return ok({ path: result.data });
  },

  copyLocalFiles: async (
    projectId: string,
    workspaceId: string,
    srcPaths: string[],
    destDirPath: string,
    options?: { overwrite?: boolean }
  ) => {
    const resolved = resolveWorkspaceFiles(projectId, workspaceId);
    if (!resolved.success) return resolved;
    const { env, fileSystem } = resolved.data;

    return await copyLocalFilesToWorkspace(fileSystem, env.path, srcPaths, destDirPath, options);
  },
});
